import { MongoClient } from 'mongodb';
import { getEmbedding } from './get-embeddings.js';
import { chunkArray } from './chunk-array.js';

const ATLAS_CONNECTION_STRING = "mongodb+srv://cklkslee:0400@lab2cluster.elg1k.mongodb.net/?retryWrites=true&w=majority&appName=Lab2Cluster"

// Connect to your Atlas cluster
const client = new MongoClient(ATLAS_CONNECTION_STRING);

async function run() {
    try {
        await client.connect();
        const db = client.db("sample_mflix");
        const collection = db.collection("movies");

        // Filter to exclude null or empty summary fields
        const filter = { "plot": { "$nin": [ null, "" ] } };

        // Get a subset of documents from the collection
        const documents = await collection.find(filter).toArray();

        // Split result set into chunks
        const docChunks = chunkArray(documents, 10); 

        // Create embeddings from a field in the collection
        let updatedDocCount = 0;
        console.log("Generating embeddings for documents...");

        for (const docChunk of docChunks) {
            await Promise.all(docChunk.map(async doc => {
            // Generate an embedding by using the function that you defined
            const embedding = await getEmbedding(doc.plot);

            // Update the document with a new embedding field
            await collection.updateOne({ "_id": doc._id },
                {
                    "$set": {
                        "embedding": embedding
                    }
                }
            );
            updatedDocCount += 1;
        }));
        console.log("Count of documents updated: " + updatedDocCount);
        }  
    } catch (err) {
        console.log(err.stack);
    }
    finally {
        await client.close();
    }
}

run().catch(console.dir);

