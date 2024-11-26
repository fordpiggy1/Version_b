import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

// MongoDB connection URI and options
const ATLAS_CONNECTION_STRING = "mongodb+srv://cklkslee:0400@lab2cluster.elg1k.mongodb.net/?retryWrites=true&w=majority&appName=Lab2Cluster";

const userClient = new MongoClient(ATLAS_CONNECTION_STRING);

const userDb = userClient.db("user_management");
const usersCollection = userDb.collection("users");

const createDefaultAdmin = async () => {
    try {
        await userClient.connect();

        const adminEmail = "donaldfktrump@gmail.com";
        const adminPassword = "admin";

        // Check if admin already exists
        const existingAdmin = await usersCollection.findOne({ email: adminEmail, role: "admin" });
        if (existingAdmin) {
            console.log("Default admin already exists.");
            return;
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        // Insert the admin user
        const newAdmin = {
            email: adminEmail,
            username: "admin", // You can customize the username as needed
            password: hashedPassword,
            role: "admin"
        };

        await usersCollection.insertOne(newAdmin);
        console.log("Default admin account created successfully.");
    } catch (error) {
        console.error("Error creating default admin:", error);
    } finally {
        await userClient.close();
    }
};

createDefaultAdmin();