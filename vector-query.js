import { MongoClient } from 'mongodb';
import { getEmbedding } from './get-embeddings.js';

// MongoDB connection URI and options
// connect to your Atlas deployment
const ATLAS_CONNECTION_STRING = "mongodb+srv://cklkslee:0400@lab2cluster.elg1k.mongodb.net/?retryWrites=true&w=majority&appName=Lab2Cluster"

// Connect to your Atlas cluster
const client = new MongoClient(ATLAS_CONNECTION_STRING);

async function run() {
    try {
        // Connect to the MongoDB client
        await client.connect();

        // Specify the database and collection
        const db = client.db("sample_mflix");
        const collection = db.collection("movies");

        // Generate embedding for the search query
        const queryEmbedding = await getEmbedding("alien transformers optimus prime");

        // Define the sample vector search pipeline
        const pipeline = [
            {
                $vectorSearch: {
                    index: "vector_index",
                    queryVector: queryEmbedding,
                    path: "embedding",
                    exact: true,
                    limit: 5
                }
            },
            {
                $project: {
                    _id: 0,
                    title: 1,
                    plot: 1,
                    score: {
                        $meta: "vectorSearchScore"
                    }
                }
            }
        ];

        // run pipeline
        const result = collection.aggregate(pipeline);

        // print results
        for await (const doc of result) {
            console.dir(JSON.stringify(doc));
        }
        } finally {
        await client.close();
    }
}
run().catch(console.dir);