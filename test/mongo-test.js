"use strict";
var assert = require('assert');
var $S = require('suspend'), $R = $S.resume, $T = function(gen) { return function(done) { $S.run(gen, done); } };

var MongoClient = require('mongodb').MongoClient;

var nodalion = require('nodalion');

var ns = nodalion.namespace('/nodalion', ['trans',
					  'set',
					  'append',
					  'get',
					  'value',
					  'check',
					  'getAll',
					  'mongoTest',
					  'mongo1',
					  'addToCounter',
					  'getAllCounters',
					  'counterValue',
					  'scan',
					  'deleteCounter',
					  'checkCounter']);

var impred = nodalion.namespace('/impred', ['task']);
var example = nodalion.namespace('example', ['foo', 'bar', 'baz', 'bat']);
var stored = [];
example._register('store1', function(str) {
    return function(nodalion, cb) {
	stored.push(str);
	cb(undefined, str);
    };
});

var nodalionMongo = require('../nodalionMongo.js');

var n = new nodalion(nodalion.__dirname + '/prolog/cedalion.pl', '/tmp/mongo-ced.log');

var doTask = function(term, cb) {
    term.meaning()(n, cb);
};

Array.prototype.meaning = function() { return this; };

function encodeUnknown(term) {
    return nodalion.encodeTerm(term, {});
};

describe('mongodb', function(){

    it('should work on the local machine', $T(function*(){
	var db = yield MongoClient.connect('mongodb://mongo:27017/test', $R());
	var coll = db.collection('test1');
	yield coll.remove({}, $R());
	yield coll.insert({_id: 'a', a:1}, $R());
	yield coll.insert({_id: 'b', a:2}, $R());
	yield coll.insert({_id: 'c', a:3}, $R());
	var arr = yield coll.find().toArray($R());
	assert.deepEqual(arr, [ { _id: 'a', a: 1 }, { _id: 'b', a: 2 }, { _id: 'c', a: 3 } ]);
	db.close();
    }));
});


describe('nodalionMongo', function(){
    var coll;
    beforeEach($T(function*() {
	var db = yield MongoClient.connect('mongodb://mongo:27017/test', $R());
	coll = db.collection('test2');
	yield coll.remove({}, $R());
    }));
    before(function() {
	nodalionMongo.db('mongodb://mongo:27017/test');
    });
    describe('.db(url)', function(){
	it('should connect to a database', function(){
	});
    });
    describe('/nodalion:trans(table, row, ops) => fields', function(){
	it('should not return any results unless asked for explicitly', $T(function*(){
	    yield doTask(ns.trans('test2', 'foo', [ns.set('fam', 'a', ['1']), ns.set('fam', 'b', ['2'])]), $R());
	    assert.deepEqual(yield doTask(ns.trans('test2', 'foo', []), $R()), []);
	}));

	describe('op /nodalion:set(family, key, values)', function(){
	    it('should assign values to key', $T(function*(){
		var result = yield doTask(ns.trans('test2', example.foo(), [ns.set('fam', example.bar(1,2,3), [example.baz(4)])]), $R());
		assert.deepEqual(result, []);

		var id = encodeUnknown(example.foo());
		var doc = yield coll.findOne({_id: id}, $R());
		assert(doc, "doc: " + doc);
		assert.equal(doc.fam[encodeUnknown(example.bar(1, 2, 3))], encodeUnknown(example.baz(4)));
	    }));
	});
	describe('op /nodalion:append(family, key, value)', function(){
	    it('should create a list of size 1 for an item that does not exist', $T(function*(){
		yield doTask(ns.trans('test2', example.foo(), [ns.append('fam', example.bar(1, 2, 3), example.baz(4))]), $R());
		
		var doc = yield coll.findOne({_id: encodeUnknown(example.foo())}, $R());
		assert(doc, "doc: " + doc);
		assert.equal(doc.fam[encodeUnknown(example.bar(1, 2, 3))], encodeUnknown(example.baz(4)));
	    }));
	    it('should append an element to the list if already exists', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.append('fam', 'bar', 'baz1')]), $R());
		yield doTask(ns.trans('test2', 'foo', [ns.append('fam', 'bar', 'baz2')]), $R());
		yield doTask(ns.trans('test2', 'foo', [ns.append('fam', 'bar', 'baz3')]), $R());
		
		var doc = yield coll.findOne({_id: encodeUnknown('foo')}, $R());
		assert.deepEqual(doc.fam[encodeUnknown('bar')], ['baz1', 'baz2', 'baz3'].map(encodeUnknown));
	    }));
	});
	describe('op /nodalion:get(family, key)', function(){
	    it('should return the requested key', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.set('fam', 'bar', ['a']), ns.set('fam', 'baz', ['b'])]), $R());
		var result = yield doTask(ns.trans('test2', 'foo', [ns.get('fam', 'bar'), ns.set('fam', 'z', ['t'])]), $R());
		assert.deepEqual(result, [ns.value('fam', 'bar', ['a'])]);
	    }));
	    it('should stand on its own without need for modification operations', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.set('fam', 'bar', ['a']), ns.set('fam', 'baz', ['b'])]), $R());
		var result = yield doTask(ns.trans('test2', 'foo', [ns.get('fam', 'bar')]), $R());
		assert.deepEqual(result, [ns.value('fam', 'bar', ['a'])]);
	    }));
	    it('should provide an empty list if the key does not exist', $T(function*(){
		var result = yield doTask(ns.trans('test2', 'foo', [ns.get('fam', 'bar')]), $R());
		assert.deepEqual(result, [ns.value('fam', 'bar', [])]);
	    }));

	});
	describe('op /nodalion:check(family, key, value)', function(){
	    it('should perform the transaction only if key maps to a single value - value', $T(function*(){
		// The following transaction will not occur because the pre-condition does not hold.
		yield doTask(ns.trans('test2', 'foo', [ns.set('fam', 'x', ['1']), ns.check('fam', 'a', ['7'])]), $R());
		assert.deepEqual(yield doTask(ns.trans('test2', 'foo', [ns.get('fam', 'x')]), $R()), [ns.value('fam', 'x', [])]);
	    }));
	    it('should allow transactions if the pre-condition holds', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.set('fam', 'a', ['7'])]), $R());
		yield doTask(ns.trans('test2', 'foo', [ns.set('fam', 'x', ['1']), ns.check('fam', 'a', ['7'])]), $R());
		assert.deepEqual(yield doTask(ns.trans('test2', 'foo', [ns.get('fam', 'x')]), $R()), [ns.value('fam', 'x', ['1'])]);
	    }));

	});
	describe('op /nodalion:getAll(family)', function(){
	    it('should return all keys for the given row', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.set('fam', 'bar', ['a']), ns.set('fam', 'baz', ['b'])]), $R());
		var result = yield doTask(ns.trans('test2', 'foo', [ns.getAll('fam')]), $R());
		assert.equal(result.length, 2);
	    }));

	});
	describe('op /nodalion:addToCounter(family, key, value)', function(){
	    it('should return a counter value of 0 if the counter was not previously set', $T(function*(){
		var res = yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key', 3)]), $R());
		assert.deepEqual(res, [ns.counterValue('fam', 'key', 0)]);
	    }));
	    it('should add value to a counter', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key', 3)]), $R());
		var res = yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key', 3)]), $R());
		assert.deepEqual(res, [ns.counterValue('fam', 'key', 3)]);
	    }));
	});
	describe('op /nodalion:getAllCounters(family)', function(){
	    it('shluld return all counters in the given family', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key1', 1)]), $R());
		yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key2', 2)]), $R());
		yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key3', 3)]), $R());
		var res = yield doTask(ns.trans('test2', 'foo', [ns.getAllCounters('fam')]), $R());
		assert.deepEqual(res, [ns.counterValue('fam', 'key1', 1), ns.counterValue('fam', 'key2', 2), ns.counterValue('fam', 'key3', 3)]);
	    }));
	});
	describe('op /nodalion:deleteCounter(family, key)', function(){
	    it('should remove a counter', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key1', 1)]), $R());
		yield doTask(ns.trans('test2', 'foo', [ns.deleteCounter('fam', 'key1')]), $R());
		var res = yield doTask(ns.trans('test2', 'foo', [ns.getAllCounters('fam')]), $R());
		assert.equal(res.length, 0);
	    }));
	});
	describe('op /nodalion:checkCounter(family, key, value)', function(){
	    it('should allow the transaction if family.key = value', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key1', 7)]), $R());
		yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key2', 1),
						       ns.checkCounter('fam', 'key1', 7)]), $R());
		var res = yield doTask(ns.trans('test2', 'foo', [ns.getAllCounters('fam')]), $R());
		assert.equal(res.length, 2);
	    }));
	    it('should not allow the transaction if family.key != value', $T(function*(){
		yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key1', 7)]), $R());
		yield doTask(ns.trans('test2', 'foo', [ns.addToCounter('fam', 'key2', 1),
						       ns.checkCounter('fam', 'key1', 6)]), $R());
		var res = yield doTask(ns.trans('test2', 'foo', [ns.getAllCounters('fam')]), $R());
		assert.equal(res.length, 1); // key1 only
	    }));
	});


	it('should integrate with Cedalion - 1', $T(function*(){
	    var X = {var:'X'};
	    var result = yield n.findAll(X, ns.mongoTest(1, X), $R());
	    assert.equal(result, 4);
	}));

	it('should integrate with Cedalion - 2', $T(function*(){
	    var X = {var:'X'};
	    var result = yield n.findAll(X, ns.mongoTest(2, X), $R());
	    assert.equal(result, 3);
	}));

	it('should integrate with Cedalion - 3', $T(function*(){
	    var X = {var:'X'};
	    var result = yield n.findAll(X, ns.mongoTest(3, X), $R());
	    assert.equal(result, 1.1);
	}));

	it('should integrate with Cedalion - 4', $T(function*(){
	    var X = {var:'X'};
	    var result = yield n.findAll(X, ns.mongoTest(4, X), $R());
	    assert.equal(result, 1);
	}));
	it('should integrate with Cedalion - 5', $T(function*(){
	    var X = {var:'X'};
	    var result = yield n.findAll(X, ns.mongoTest(5, X), $R());
	    assert.equal(result, 1.1);
	}));
	it('should integrate with Cedalion - 6', $T(function*(){
	    var X = {var:'X'};
	    var result = yield n.findAll(X, ns.mongoTest(6, X), $R());
	    assert.equal(result, 2);
	}));
	it('should integrate with Cedalion - 7', $T(function*(){
	    var X = {var:'X'};
	    var result = yield n.findAll(X, ns.mongoTest(7, X), $R());
	    assert.equal(result[0], 1);
	}));
    });
    describe('/nodalion#scan(Table, Row, Type, Goal)', function(){
	it('should evaluate Goal for each Row in Table', $T(function*(){
	    yield doTask(ns.trans('test2', 'a', [ns.set('fam', 1, [1])]), $R());
	    yield doTask(ns.trans('test2', 'b', [ns.set('fam', 1, [1])]), $R());
	    yield doTask(ns.trans('test2', 'c', [ns.set('fam', 1, [1])]), $R());
	    stored = [];
	    yield doTask(ns.scan('test2', {var:'X'}, {var:'_Type'}, impred.task(example.store1({var:'X'}), {var:'_Res'}, {var:'_Type'})), $R());
	    assert.deepEqual(stored, ['a', 'b', 'c']);
	}));
	it('should integrate with Cedalion', $T(function*(){
	    var X = {var:'X'};
	    var result = yield n.findAll(X, ns.mongoTest(10, X), $R());
	    assert.equal(result[0], 2);
	}));

    });
});
