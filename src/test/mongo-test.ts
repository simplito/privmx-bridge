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

async function go() {
    const mongoUrl = "mongodb://localhost:27017";
    const client = await mongodb.MongoClient.connect(mongoUrl, {minPoolSize: 5, maxPoolSize: 5});
    const db = client.db("privmx_lukas2");
    try {
        await db.createCollection("test");
    }
    catch {
        // Do nothing
    }
    const collection = db.collection<any>("test");
    const id = "123";
    await collection.deleteOne({_id: id});
    await collection.insertOne({_id: id, data: "000"});
    
    const tryInsert = async (no: number) => {
        const session = client.startSession();
        try {
            await session.withTransaction(async () => {
                console.log(no, "Start transaction");
                const entry = await collection.findOne({_id: id}, {session});
                if (entry && entry.data == "000") {
                    console.log(no, "Recreate");
                    await collection.deleteOne({_id: id}, {session});
                    await collection.insertOne({_id: id, data: no}, {session});
                    console.log(no, "Created");
                }
                else if (entry) {
                    console.log(no, "Already exists");
                }
                else {
                    console.log(no, "Creating");
                    await collection.insertOne({_id: id, data: no}, {session});
                    // await collection.replaceOne({_id: id}, {_id: id, data: no}, {upsert: true, session});
                    console.log(no, "Created");
                }
            }, {
                readPreference: "primary",
                readConcern: {
                    level: "local",
                },
                writeConcern: {
                    w: "majority",
                },
            });
        }
        catch (e) {
            console.log(no, "Error", e);
        }
        finally {
            await session.endSession();
        }
    };
    
    await Promise.all([
        tryInsert(1),
        tryInsert(2),
        tryInsert(3),
    ]);
    await collection.deleteOne({_id: id});
    await client.close();
}

void go();
