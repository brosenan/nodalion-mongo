"use strict";
var $S = require('suspend'), $R = $S.resume;
var MongoClient = require('mongodb').MongoClient;

var Nodalion = require('nodalion');

var ns = Nodalion.namespace('/nodalion', ['value', 'counterValue', 'bind']);


var _db;
var dbListeners = [];
var _nodalion;
var _namesArr = [];
var _namesMap = {};
var _gettingList = false;
var DEBUG = ('NODALION_DEBUG' in process.env);

function getDB(nodalion, cb) {
    if(_db) {
	if(!_gettingList) {
	    updateNameMap(_db, nodalion, function(err) {
		cb(err, _db);
	    });
	} else {
	    return cb(undefined, _db);
	}
    } else {
	_nodalion = nodalion;
	dbListeners.push(cb);
    }
}

var updateNameMap = $S.callback(function*(db, nodalion) {
    if(_gettingList) {
	return;
    } else {
	_gettingList = true;
    }
    var namesDoc = yield db.collection('_names').findOne({_id: 'names'}, $R());
    if(namesDoc) {
	_namesArr = namesDoc.namesArr;
    }
    var oldLen = _namesArr.length;
    _namesArr.forEach(function(name, i) {
	_namesMap[name] = i;
    });
    yield Nodalion.updateNameDict(nodalion, _namesMap, _namesArr, $R());
    if(_namesArr.length > oldLen) {
	yield db.collection('_names').update({_id: 'names'}, {$set: {namesArr: _namesArr}}, {upsert: true}, $R());
    }
});

function encode(term) {
    return Nodalion.encodeTerm(term, _namesMap);
}

function decode(b64) {
    return Nodalion.decodeTerm(b64, _namesArr);
}

exports.db = function(url) {
    MongoClient.connect(url, function(err, db) {
	_db = db;
	if(_nodalion) {
	    updateNameMap(db, _nodalion, function(err) {
		dbListeners.forEach(function(listener) {
		    listener(err, db);
		});
	    });
	}
    });
};

ns._register('trans', function(coll, row, ops) {
    ops = ops.meaning().map(op => op.meaning());
    return function(nodalion, cb) {
	$S.callback(function*(nodalion) {
	    var db = yield getDB(nodalion, $R());
	    var update = {};
	    var fields = {_id:1};
	    var query = {};
	    var options = {upsert: true, 
			   projection: fields};
	    var postProcessing = [];
	    ops.forEach(function(op) {
		op(update, fields, query, options, postProcessing);
	    });
	    query._id = encode(row);
	    var result;
	    if(Object.keys(update).length > 0) {
		result = yield db.collection(coll).findOneAndUpdate(query, 
								    update, 
								    options, $R());
		result = result.value;
	    } else {
		result = yield db.collection(coll).findOne({_id: encode(row)}, {fields: fields}, $R());
	    }
	    if(result) {
		delete result._id;
	    } else {
		result = Object.create(null);
	    }
	    postProcessing.forEach(function(post) {
		post(result);
	    });
	    var families = Object.keys(result || {});
	    return [].concat.apply([], families.map(function(family) {
		if(family[0] === '#') { // counter family
		    return Object.keys(result[family]).map(function(key) {
			return ns.counterValue(family.substr(1), decode(key), result[family][key]);
		    });
		} else {
		    return Object.keys(result[family]).map(function(key) {
			return ns.value(family, decode(key), result[family][key].map(decode));
		    });
		}
	    }));
	})(nodalion, cb);
    };
});

ns._register('set', function(family, key, values) {
    values = values.meaning();
    return function(update) {
	if(!update.$set) {
	    update.$set = {};
	}
	update.$set[family + '.' + encode(key)] = values.map(encode);
    };
});

ns._register('append', function(family, key, value) {
    return function(update) {
	if(!update.$push) {
	    update.$push = {};
	}
	update.$push[family + '.' + encode(key)] = encode(value);
    };
});

ns._register('get', function(family, key) {
    return function(update, fields, query, options, postProcessing) {
	key = encode(key);
	fields[family + '.' + key] = 1;
	postProcessing.push(function(res) {
	    if(!(family in res)) {
		res[family] = {};
	    }
	    if(!(key in res[family])) {
		res[family][key] = [];
	    }
	});
    };
});

ns._register('check', function(family, key, value) {
    return function(update, fields, query, options) {
	query[family + '.' + encode(key)] = value.meaning().map(encode);
	options.upsert = false;
    };
});

ns._register('getAll', function(family) {
    return function(upsert, fields) {
	fields[family] = 1;
    };
});

ns._register('addToCounter', function(family, key, value) {
    return function(update, fields, query, options, postProcessing) {
	var ekey = encode(key);
	family = '#' + family;

	if(!update.$inc) {
	    update.$inc = {};
	}
	update.$inc[family + '.' + ekey] = value;
	fields[family + '.' + ekey] = 1;

	if(DEBUG) {
	    update.$inc['debug.' + family + '.' + ekey + '.v'] = value;
	    if(!update.$set) {
		update.$set = {};
	    }
	    update.$set['debug.' + family + '.' + ekey + '.k'] = key.toString();
	}
	
	postProcessing.push(function(res) {
	    if(!(family in res)) {
		res[family] = {};
	    }
	    if(!(ekey in res[family])) {
		res[family][ekey] = 0;
	    }
	});
    };
});
ns._register('getAllCounters', function(family) {
    return function(upsert, fields) {
	family = '#' + family;
	fields[family] = 1;
    };
});
ns._register('deleteCounter', (family, key) => (update) => {
    if(!update.$unset) {
	update.$unset = {};
    }
    update.$unset['#' + family + '.' + encode(key)] = '';
});
ns._register('checkCounter', (family, key, value) => (update, fields, query, options) => {
    query['#' + family + '.' + encode(key)] = value;
    options.upsert = false;
});

ns._register('scan', function(table, row, type, goal) {
    return $S.callback(function*(nodalion) {
	var db = yield getDB(nodalion, $R());
	var cursor = db.collection(table).find({});
	while(true) {
	    var doc = yield cursor.next($R());
	    if(!doc) break;
	    yield nodalion.findAll({var:'_'}, ns.bind(decode(doc._id), row, {var:'_T'}, goal), $R());
	}
	return '';
    });
});
