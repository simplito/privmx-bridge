/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

/* eslint-disable no-console */

import * as mongodb from "mongodb";

export class MongoDebug {
    
    static DEBUG = false;
    
    static decorateClient(client: mongodb.MongoClient) {
        if (!MongoDebug.DEBUG || (client as any).__debugDecorated) {
            return client;
        }
        (client as any).__debugDecorated = true;
        const orgDbFunc = client.db.bind(client) as any;
        client.db = (...args: any) => {
            // if (MongoDebug.DEBUG) {
            //     console.log("MONGO db " + args[0]);
            // }
            return MongoDebug.decorateDb(orgDbFunc(...args));
        };
        return client;
    }
    
    static decorateDb(db: mongodb.Db) {
        if (!MongoDebug.DEBUG || (db as any).__debugDecorated) {
            return db;
        }
        (db as any).__debugDecorated = true;
        const orgCollectionFuc = db.collection.bind(db) as any;
        db.collection = (...args: any) => {
            // if (MongoDebug.DEBUG) {
            //     console.log("MONGO collection " + db.databaseName + "." + args[0]);
            // }
            return MongoDebug.decorateCollection(db, orgCollectionFuc(...args));
        };
        return db;
    }
    
    static decorateCollection<T extends mongodb.Document>(db: mongodb.Db, collection: mongodb.Collection<T>) {
        if (!MongoDebug.DEBUG || (collection as any).__debugDecorated) {
            return collection;
        }
        (collection as any).__debugDecorated = true;
        const colName = db.databaseName + "." + collection.collectionName;
        const col: any = {
            collectionName: collection.collectionName,
        };
        const decorateFunc = (funcName: string) => {
            col[funcName] = (...args: any[]) => {
                const start = Date.now();
                const result = (collection as any)[funcName](...args);
                if (result.then) {
                    result.then(() => console.log("MONGO", funcName, colName, Date.now() - start + "ms", ...args.map((x, i) => i === args.length - 1 && x && x.session ? {...x, session: x.session.constructor.name} : x)));
                }
                else {
                    if (funcName === "find" || funcName === "aggregate") {
                        let called = false;
                        const orgToArray = result.toArray.bind(result);
                        result.toArray = (...nArgs: any []) => {
                            const res = orgToArray(...nArgs);
                            if (res.then) {
                                called = true;
                                res.then(() => console.log("MONGO", funcName + ".toArray", colName, Date.now() - start + "ms", ...args.map((x, i) => i === args.length - 1 && x && x.session ? {...x, session: x.session.constructor.name} : x)));
                            }
                            return res;
                        };
                        if (result.count) {
                            const orgCount = result.count.bind(result);
                            result.count = (...nArgs: any []) => {
                                const res = orgCount(...nArgs);
                                if (res.then) {
                                    called = true;
                                    res.then(() => console.log("MONGO", funcName + ".count", colName, Date.now() - start + "ms", ...args.map((x, i) => i === args.length - 1 && x && x.session ? {...x, session: x.session.constructor.name} : x)));
                                }
                                return res;
                            };
                        }
                        setTimeout(() => {
                            if (!called) {
                                console.log("MONGO", funcName, colName, "?? ms", ...args.map((x, i) => i === args.length - 1 && x && x.session ? {...x, session: x.session.constructor.name} : x));
                            }
                        }, 1);
                    }
                    else {
                        console.log("MONGO", funcName, colName, "?? ms", ...args.map((x, i) => i === args.length - 1 && x && x.session ? {...x, session: x.session.constructor.name} : x));
                    }
                }
                return result;
            };
        };
        [
            "update",
            "updateOne",
            "updateMany",
            "insert",
            "insertOne",
            "insertMany",
            "find",
            "findOne",
            "findOneAndDelete",
            "findOneAndReplace",
            "findOneAndUpdate",
            "replaceOne",
            "deleteOne",
            "deleteMany",
            "aggregate",
        ].map(x => decorateFunc(x));
        return col as mongodb.Collection<T>;
    }
}
