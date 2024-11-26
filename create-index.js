import { MongoClient } from 'mongodb';

// connect to your Atlas deployment
const ATLAS_CONNECTION_STRING = "mongodb+srv://cklkslee:0400@lab2cluster.elg1k.mongodb.net/?retryWrites=true&w=majority&appName=Lab2Cluster"

// Connect to your Atlas cluster
const client = new MongoClient(ATLAS_CONNECTION_STRING);

async function run() {
  try {
    const db = client.db("sample_mflix");
    const collection = db.collection("movies");

    // const query = { embedding:null };
    // const delete_result = await collection.deleteMany(query);
    // console.log(delete_result)
   
    // Define your Atlas Vector Search index
    const index = {
        name: "vector_index",
        type: "vectorSearch",
        definition: {
          "fields": [
            {
              "type": "vector",
              "path": "embedding",
              "similarity": "cosine",
              "numDimensions": 768
            }
          ]
        }
    }

    // Call the method to create the index
    const result = await collection.createSearchIndex(index);
    console.log(result);
  } finally {
    await client.close();
  }
}
run().catch(console.dir);
