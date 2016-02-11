"use strict";
var $S = require('suspend'), $R = $S.resume;
var MongoClient = require('mongodb').MongoClient;

$S.run(function*() {
    if(process.argv.length < 3) {
	console.error('usage: ' + process.argv.slice(0, 2).join(' ') + ' URL');
	process.exit(1);
    }
    var url = process.argv[2];
    var db = yield MongoClient.connect(url, $R());
    var collNames = (yield db.collections($R())).map(c => c.s.name);
    for(let i = 0; i < collNames.length; i++) {
	let collName = collNames[i];
	if(collName in {'_names':1, 'system.indexes':1}) continue;
	console.log("Table: " + collName);
	console.log("============ ");
	var cursor = db.collection(collName).find({});
	while(true) {
	    var doc = yield cursor.next($R());
	    if(!doc) break;
	    var dbg = doc.debug;
	    if(dbg) {
		console.log('  Row: ' + collName + ':' + dbg._row);
		console.log("  -------------");
		Object.keys(dbg).forEach(fam => {
		    if(fam === '_row') return;
		    console.log('    Family: ' + fam);
		    console.log("    -------------");
		    Object.keys(dbg[fam]).forEach(counter => {
			console.log('    - ' + dbg[fam][counter].k + ' => ' + dbg[fam][counter].v);
		    });
		});
	    }
	}
    };
    db.close();
});
