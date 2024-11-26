import express from "express";
import session from "express-session";
import { getEmbedding } from './get-embeddings.js';
import { MongoClient, ObjectId } from "mongodb";
import flash from 'connect-flash';
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import MongoStore from "connect-mongo";
import methodOverride from "method-override";

// Initialize env
const app = express();

// MongoDB connection URI and options
const ATLAS_CONNECTION_STRING = "mongodb+srv://cklkslee:0400@lab2cluster.elg1k.mongodb.net/?retryWrites=true&w=majority&appName=Lab2Cluster";
const SESSION_SECRET = "your_session_secret";

const userClient = new MongoClient(ATLAS_CONNECTION_STRING);
const movieClient = new MongoClient(ATLAS_CONNECTION_STRING);

const userDb = userClient.db("user_management");
const usersCollection = userDb.collection("users");
const movieDb = movieClient.db("sample_mflix");
const moviesCollection = movieDb.collection("movies");
const userFavoritesCollection = userDb.collection("favorites");

await userClient.connect();
await movieClient.connect();

// Loading middlewares
app.set("view engine", "ejs");
app.use(methodOverride("_method"));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false })); 
app.use(express.json());
app.use(flash());
app.use(express.static('public'));
app.use(
    session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({
            clientPromise: userClient.connect(),
            dbName: "user_management",
        }),
    })
);
app.use(passport.initialize());
app.use(passport.session());

// Passport initialization
passport.use(
    new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
        try {
            const user = await usersCollection.findOne({ email });

            if (!user) {
                return done(null, false, { message: "Email not registered" });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return done(null, false, { message: "Password Error" });
            }

            return done(null, user);
        } catch (error) {
            return done(error);
        }
    })
);

passport.serializeUser((user, done) => {
    done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await usersCollection.findOne({ _id: new ObjectId(id) });
        done(null, user);
    } catch (error) {
        done(error);
    }
});

// Authentication functions
const ensureAuthenticated = (req, res, next) => {
    console.log("Checking authentication");
    console.log("Is authenticated:", req.isAuthenticated());
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect("/login");
};

const ensureAdmin = (req, res, next) => {
    if (req.isAuthenticated() && req.user.role === "admin") {
        return next();
    }
    res.redirect("/adminlogin");
};

// Handler functions 
// Modify the searchByPlot function to handle searchType
const searchByPlot = async (req, res) => {
    try {
        const { queryStr, searchType } = req.query;

        if (!queryStr || !searchType) {
            return res.render("resultByPlots", {
                movies: [],
                userFav: [], 
                user: req.user, 
                req: req,
                error: "Search query and search type are required.",
            });
        }

        const db = movieClient.db("sample_mflix");
        const collection = db.collection("movies");

        let searchCriteria = {};
        if (searchType === "title") {
            searchCriteria = { title: { $regex: queryStr, $options: "i" } };
        } else if (searchType === "genre") {
            searchCriteria = { genres: { $regex: queryStr, $options: "i" } };
        } else {
            return res.render("resultByPlots", {
                movies: [],
                userFav: [], 
                user: req.user, 
                req: req,
                error: "Invalid search type selected.",
            });
        }

        // Generate embedding for the search query if needed
        let results = [];
        if (searchType === "title" || searchType === "genre") {
            results = await collection.find(searchCriteria).toArray();
        }

        const userFav = await userFavoritesCollection.find({userId: req.user._id}).toArray();
        res.status(200).render('resultByPlots', {
            movies: results,
            userFav: userFav[0] ? userFav[0] : { favorites: [] },
            user: req.user,
            req: req,
            error: null
        });
    } catch (error) {
        console.error("Error in searchByPlot:", error);
        res.render("resultByPlots", {
            movies: [],
            userFav: [], 
            user: req.user, 
            req: req,
            error: "An error occurred while searching for movies.",
        });
    }
}

// Routing

// User registration
app.get("/register", (req, res) => {
    res.render("userSignup", { error: null });
});

app.post("/register", async (req, res) => {
    const { email, username, password, confirmPassword } = req.body;

    if (!email || !username || !password || !confirmPassword) {
        return res.render("userSignup", { error: "All fields are required" });
    }

    if (password !== confirmPassword) {
        return res.render("userSignup", { error: "The password is different from the confirmation password" });
    }

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
        return res.render("userSignup", { error: "The email address has been registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await usersCollection.insertOne({ email, username, password: hashedPassword, role: "user" });

    res.redirect("/login");
});

// User login
app.get("/login", (req, res) => {
    const error = req.flash("error");
    res.render("login", { error: error.length > 0 ? error[0] : null });
});

app.post(
    "/login",
    passport.authenticate("local", {
        failureRedirect: "/login",
        failureFlash: true,
    }),
    (req, res) => {
        // Redirect to stored path or a role-specific path
        const redirectTo = req.session.returnTo || (req.user.role === "admin" ? "/admin" : "/");
        delete req.session.returnTo; // Clear the session variable
        res.redirect(redirectTo);
    }
);

app.get("/logout", (req, res) => {
    req.logout(err => {
        if (err) {
            console.error("Logout error:", err);
            return res.redirect("/");
        }
        req.session.destroy(() => {
            res.redirect("/");
        });
    });
});

// // User dashboard
// app.get("/user-dashboard", ensureAuthenticated, async (req, res) => {
//     res.render("user-dashboard", { user: req.user, movies: [], error: null });
// });

// Favorite movies (users only)
app.post("/favorites", ensureAuthenticated, async (req, res) => {
    try {
        // console.log(req.body.movieId); 
        const movieId  = req.body.movieId; 

        if (!movieId) {
            return res.status(400).send({ error: "Movie ID is required" });
        }

        const existingMovie = await moviesCollection.findOne({ _id: new ObjectId(movieId) });
        if (!existingMovie) {
            return res.status(404).send({ error: "Movie not found" });
        }

        await userFavoritesCollection.updateOne(
            { userId: req.user._id }, 
            { $addToSet: { favorites: new ObjectId(movieId) } }, 
            { upsert: true } 
        );

        const redirectUrl = req.get('referer') || '/';
        res.redirect(redirectUrl);

    } catch (error) {
        console.error("Error in addFavorite:", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
});

//Delete Favorites (User only)
app.post("/favorites/:movieId", ensureAuthenticated, async (req, res) => {
    const { action } = req.query;

    if (action === "delete") {
        const { movieId } = req.params;

        if (!ObjectId.isValid(movieId)) {
            return res.status(400).send({ error: "Invalid Movie ID" });
        }

        try {
            await userFavoritesCollection.updateOne(
                { userId: req.user._id },
                { $pull: { favorites: new ObjectId(movieId) } }
            );

            res.redirect("/user/favorites");
        } catch (error) {
            console.error("Error in removeFavorite:", error);
            res.status(500).send({ error: "Internal Server Error" });
        }
    } else {
        res.status(400).send({ error: "Unsupported action or missing action parameter" });
    }
});


//Render favorites
app.get("/user/favorites", ensureAuthenticated, async (req, res) => {
    try {
        const userFavorites = await userFavoritesCollection.findOne({ userId: req.user._id });
        const favoriteMovieIds = userFavorites ? userFavorites.favorites : [];

        const favorites = await moviesCollection
            .find({ _id: { $in: favoriteMovieIds } })
            .toArray();

        res.render("favorites", { favorites, user: req.user, req}); 
    } catch (error) {
        console.error("Error fetching favorites:", error);
        res.status(500).send("Internal Server Error");
    }
});

//Profile edit
app.post("/profile/edit", ensureAuthenticated, async (req, res) => {
    const { username, currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword) {
        return res.render("UsereditProfile", {
            user: req.user,
            error: "Current password is required to update your profile",
        });
    }

    const user = await usersCollection.findOne({ _id: new ObjectId(req.user._id) });
    const isPasswordCorrect = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordCorrect) {
        return res.render("UsereditProfile", {
            user: req.user,
            error: "Current password is incorrect",
        });
    }

    if (!username && !newPassword) {
        return res.render("UsereditProfile", {
            user: req.user,
            error: "You must provide at least a new username or a new password",
        });
    }

    if (newPassword && newPassword !== confirmNewPassword) {
        return res.render("UsereditProfile", {
            user: req.user,
            error: "New password and confirmation password do not match",
        });
    }

    const updates = {};
    if (username && username !== req.user.username) {
        updates.username = username;
    }
    if (newPassword) {
        updates.password = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updates).length === 0) {
        return res.render("UsereditProfile", {
            user: req.user,
            error: "No changes detected in the profile",
        });
    }

    await usersCollection.updateOne({ _id: new ObjectId(req.user._id) }, { $set: updates });

    const updatedUser = await usersCollection.findOne({ _id: new ObjectId(req.user._id) });
    req.login(updatedUser, (err) => {
        if (err) {
            return res.render("UsereditProfile", {
                user: req.user,
                error: "Profile updated, but an error occurred during session refresh",
            });
        }
        res.render("UsereditProfile", {
            user: updatedUser,
            error: "Profile updated successfully!",
        });
    });
});

app.get("/profile/edit", ensureAuthenticated, (req, res) => {
    res.render("UsereditProfile", {
        user: req.user,
        error: null,
    });
});



//Admin part
// Search for movies (accessible to all admin)

app.get("/adminlogin", (req, res) => {
    const error = req.flash("error");
    res.render("adminlogin", { error: error }); // Pass the actual error instead of null
});

app.post(
    "/adminlogin",
    passport.authenticate("local", {
        failureRedirect: "/adminlogin",
        failureFlash: true, 
    }),
    (req, res) => {
        if (req.user.role !== "admin") {
            req.logout(); 
            return res.redirect("/adminlogin");
        }
        res.redirect("/admin-dashboard"); 
    }
);

app.get("/admin-dashboard", ensureAuthenticated, ensureAdmin, (req, res) => {
    res.render("admin-dashboard", { user: req.user, movies: [], error: null });
});

app.post("/movies/admin/search", ensureAuthenticated, async (req, res) => {
    try {
        const query = req.body.query;
        if (!query) {
            return res.render("admin-dashboard", {
                user: req.user, 
                movies: [],
                error: "Please enter a search term.",
            });
        }

	
        const queryEmbedding = await getEmbedding(query);

        const pipeline = [
            {
                $vectorSearch: {
                    index: "vector_index",
                    queryVector: queryEmbedding,
                    path: "embedding",
                    exact: true,
                    limit: 10,
                },
            },
            {
                $project: {
                    _id: 1,
                    title: 1,
                    plot: 1,
                },
            },
        ];

        const movies = await moviesCollection.aggregate(pipeline).toArray();

        res.render("admin-dashboard", {
            user: req.user, 
            movies,
            error: movies.length === 0 ? "No movies found." : null,
        });
    } catch (error) {
        console.error("Error in searchByPlot:", error);
        res.render("admin-dashboard", {
            user: req.user,
            movies: [],

            error: "An error occurred while searching for movies.",
        });
    }
});

app.post("/movies/admin/searchByTitle", ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { query, searchType, commonGenres } = req.body;
    let searchCriteria;

    if (searchType === 'title') {
        searchCriteria = { title: { $regex: query, $options: "i" } };
    } else if (searchType === 'genre') {
        searchCriteria = { genres: { $regex: query, $options: "i" } };
    } else {
        return res.status(400).send({ error: "Invalid search type" });
    }

    if (commonGenres && commonGenres.length > 0) {
        searchCriteria.genres = { $in: commonGenres };
    }

    try {
        const movies = await moviesCollection.find(searchCriteria).toArray();

        res.render("admin-dashboard", {
            user: req.user, 
            movies,
            error: movies.length === 0 ? "No movies found." : null,
        });
    } catch (error) {
        console.error("Error in searchByTitle:", error);
        res.render("admin-dashboard", {
            user: req.user,
            movies: [],
            error: "An error occurred while searching for movies.",
        });
    }
});

// Add Movies (admin only)
app.get("/movies/add", ensureAdmin, async (req, res) => {
    try {
        res.render("addMovie", { user: req.user, error: null });
    } catch (error) {
        console.error("Error in rendering addMovie page:", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
});

app.post("/movies/add", ensureAdmin, async (req, res) => {
    try {
        const { title, plot, genres, director, releaseDate, runtime, poster } = req.body;

        if (!title || !plot) {
            return res.status(400).send({ error: "Title and plot are required" });
        }

        const embedding = await getEmbedding(plot);
        const newMovie = {
            title,
            plot,
            genres: genres ? genres.split(',').map(genre => genre.trim()) : [],
            director,
            releaseDate: releaseDate ? new Date(releaseDate) : null,
            runtime: runtime ? parseInt(runtime) : null,
            poster,
            embedding
        };
        const result = await moviesCollection.insertOne(newMovie);

        res.redirect("/admin-dashboard");
    } catch (error) {
        console.error("Error in createMovie:", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
});

// Update Movies (admin only)
app.get("/movies/edit/:id", ensureAdmin, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid Movie ID" });
    }

    try {
        const movie = await moviesCollection.findOne({ _id: new ObjectId(id) });

        if (!movie) {
            return res.status(404).send({ error: "Movie not found" });
        }

        res.render("editMovie", { movie }); 
    } catch (error) {
        console.error("Error in getEditMovie:", error);
        res.status(500).send({ error: "Internal Server Error" });
    }
});

app.post("/movies/edit/:id", ensureAdmin, async (req, res) => {
    const { action } = req.query; 
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid Movie ID" });
    }

    if (action === "edit") {
        const { title, plot, genres, director, releaseDate, runtime, poster, commonGenres } = req.body;

        if (!title && !plot) {
            return res.status(400).send({ error: "At least one of title or plot is required" });
        }

        try {
            const updateFields = {};
            if (title) updateFields.title = title;
            if (plot) {
                updateFields.plot = plot;
                updateFields.embedding = await getEmbedding(plot);
            }
            // Handle genres field
            let allGenres = [];
            if (genres) {
                allGenres = genres.split(',').map(genre => genre.trim());
            }
            if (commonGenres) {
                if (Array.isArray(commonGenres)) {
                    allGenres = allGenres.concat(commonGenres);
                } else {
                    allGenres.push(commonGenres);
                }
            }
            if (allGenres.length > 0) {
                updateFields.genres = allGenres;
            }
            // ...existing code...
            if (director) updateFields.director = director;
            if (releaseDate) updateFields.releaseDate = new Date(releaseDate);
            if (runtime) updateFields.runtime = parseInt(runtime);
            if (poster) updateFields.poster = poster;

            const result = await moviesCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateFields });

            if (result.matchedCount === 0) {
                return res.status(404).send({ error: "Movie not found" });
            }

            res.redirect("/admin-dashboard");
        } catch (error) {
            console.error("Error in updateMovie:", error);
            res.status(500).send({ error: "Internal Server Error" });
        }
    } else {
        res.status(400).send({ error: "Unsupported action or missing action parameter" });
    }
});



// Delete Movies (admin only)
app.post("/movies/:id", ensureAdmin, async (req, res) => {
    const { action } = req.query;
    
    if (action === "delete") {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ error: "Invalid Movie ID" });
        }

        try {
            const result = await moviesCollection.deleteOne({ _id: new ObjectId(id) });

            if (result.deletedCount === 0) {
                return res.status(404).send({ error: "Movie not found" });
            }

            res.redirect("/admin-dashboard");
        } catch (error) {
            console.error("Error in deleteMovie:", error);
            res.status(500).send({ error: "Internal Server Error" });
        }
    } else {
        res.status(400).send({ error: "Unsupported action or missing action parameter" });
    }
});

app.get("/adminprofile/edit", ensureAuthenticated, (req, res) => {
    res.render("AdmineditProfile", {
        user: req.user,
        error: null,
    });
});

//AdmineditProfile

app.post("/adminprofile/edit", ensureAuthenticated, async (req, res) => {
    const { username, currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword) {
        return res.render("AdmineditProfile", {
            user: req.user,
            error: "Current password is required to update your profile",
        });
    }

    const user = await usersCollection.findOne({ _id: new ObjectId(req.user._id) });

    const isPasswordCorrect = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordCorrect) {
        return res.render("AdmineditProfile", {
            user: req.user,
            error: "Current password is incorrect",
        });
    }

    if (!username && !newPassword) {
        return res.render("AdmineditProfile", {
            user: req.user,
            error: "You must provide at least a new username or a new password",
        });
    }

    if (newPassword && newPassword !== confirmNewPassword) {
        return res.render("AdmineditProfile", {
            user: req.user,
            error: "New password and confirmation password do not match",
        });
    }

    const updates = {};
    if (username && username !== req.user.username) {
        updates.username = username;

    }
    if (newPassword) {
        updates.password = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updates).length === 0) {
        return res.render("AdmineditProfile", {
            user: req.user,
            error: "No changes detected in the profile",
        });
    }

    await usersCollection.updateOne({ _id: new ObjectId(req.user._id) }, { $set: updates });

    const updatedUser = await usersCollection.findOne({ _id: new ObjectId(req.user._id) });
    req.login(updatedUser, (err) => {
        if (err) {
            return res.render("AdmineditProfile", {
                user: req.user,
                error: "Profile updated, but an error occurred during session refresh",
            });
        }
        res.render("AdmineditProfile", {
            user: updatedUser,

            error: "Profile updated successfully!",
        });
    });
});

// Route to display admin registration form
app.get("/admin/register", ensureAuthenticated, ensureAdmin, (req, res) => {
    res.render("adminRegister", { error: null });
});

// Route to handle admin registration
app.post("/admin/register", ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { email, username, password, confirmPassword } = req.body;

    if (!email || !username || !password || !confirmPassword) {
        return res.render("adminRegister", { error: "All fields are required." });
    }

    if (password !== confirmPassword) {
        return res.render("adminRegister", { error: "Passwords do not match." });
    }

    try {
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            return res.render("adminRegister", { error: "Email already in use." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await usersCollection.insertOne({ email, username, password: hashedPassword, role: "admin" });

        res.redirect("/admin-dashboard");
    } catch (error) {
        console.error("Error creating admin account:", error);
        res.status(500).render("adminRegister", { error: "Internal Server Error." });
    }
});

app.get('/', (req,res) => {
    res.status(200).render('home', {user: req.user, req: req});
})

app.get('/search', ensureAuthenticated, (req,res) => {
    searchByPlot(req, res);
})

app.get('/admin', (req,res) => {
    res.status(200).render('admin');
})


//API
//Admin Create Movies

app.post("/api/addmovies/:password", async (req, res) => {
    try {
        const SERVER_PASSWORD = "5201314";
	
	const { password } = req.params;
	
        const { title, plot } = req.body;

        if (!password) {
            return res.status(403).json({ error: "Password is required to use this API." });
        }

        if (password !== SERVER_PASSWORD) {
            return res.status(403).json({ error: "Invalid password." });
        }

        if (!title || !plot) {
            return res.status(400).json({ error: "Title and plot are required fields." });
        }

        const existingMovie = await moviesCollection.findOne({ title });
        if (existingMovie) {
            return res.status(409).json({ 
                error: `A movie with the title "${title}" already exists in the database.` 
            });
        }

        const plot_embedding = await getEmbedding(plot);

        const newMovie = {
            title,
            plot,
            plot_embedding, 
            createdAt: new Date(),
        };

        const result = await moviesCollection.insertOne(newMovie);

        res.status(200).json({
            message: "Movie created successfully",
            movie: {
                _id: result.insertedId,
                title,
                plot,
            },
        });
    } catch (error) {
        console.error("Error in protectedAddMovie:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


//Admin Update Movies

app.put("/api/updatemovies/:password", async (req, res) => {
    try {

        const SERVER_PASSWORD = "5201314";

	const { password } = req.params;

        const { searchTitle, newTitle, newPlot } = req.body;

        if (!password) {
            return res.status(403).json({ error: "Password is required to use this API." });
        }

        if (password !== SERVER_PASSWORD) {
            return res.status(403).json({ error: "Invalid password." });
        }

        if (!searchTitle) {
            return res.status(400).json({ error: "The movie title to search is required." });
        }

        if (!newTitle && !newPlot) {
            return res.status(400).json({ error: "At least one of newTitle or newPlot is required." });
        }

        const updateFields = {};
        if (newTitle) updateFields.title = newTitle;
        if (newPlot) {
            updateFields.plot = newPlot;
            updateFields.plot_embedding = await getEmbedding(newPlot); 
        }

        const result = await moviesCollection.updateOne(
            { title: searchTitle }, 
            { $set: updateFields }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Movie not found." });
        }

        res.status(200).json({
            message: "Movie updated successfully",
        });
    } catch (error) {
        console.error("Error in updateMovie:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});



//Admin Delete Movies

app.delete("/api/deletemovies/:password/:title", async (req, res) => {
    try {

        const SERVER_PASSWORD = "5201314";

        const { password, title } = req.params;

        if (!password) {
            return res.status(403).json({ error: "Password is required to use this API." });
        }

        if (password !== SERVER_PASSWORD) {
            return res.status(403).json({ error: "Invalid password." });
        }

        if (!title) {
            return res.status(400).json({ error: "Movie title is required for deletion." });
        }

        const result = await moviesCollection.deleteOne({ title });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Movie not found." });
        }

        res.status(200).json({ message: `Movie with title "${title}" deleted successfully.` });
    } catch (error) {
        console.error("Error in deleteMovie:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

//Read api

app.get("/api/readmovies/:title", async (req, res) => {
    try {
        const { title } = req.params;

        if (!title) {
            return res.status(400).json({ error: "Title is required to fetch movie details." });
        }

        const movie = await moviesCollection.findOne({ title });

        if (!movie) {
            return res.status(404).json({ error: `No movie found with the title "${title}"` });
        }

        res.status(200).json({
            title: movie.title,
            fullplot: movie.plot || "No detailed plot available.",
        });
    } catch (error) {
        console.error("Error in getMovieByTitle:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Multi-parameter query API
app.get("/api/readmovies/:parameters*", async (req, res) => {
    try {
        const paramsArray = req.params.parameters ? req.params.parameters.split('/') : [];
        const criteria = {};

        // Assemble query criteria
        for (let i = 0; i < paramsArray.length; i += 2) {
            const key = paramsArray[i];
            const value = paramsArray[i + 1];
            if (value && value !== '') {
                criteria[key] = value;
            }
        }

        if (Object.keys(criteria).length === 0) {
            return res.status(400).json({ error: "At least one query parameter is required." });
        }

        // Define the fields to return, excluding _id and embedding
        const projection = { _id: 0, embedding: 0 };

        const movies = await moviesCollection.find(criteria).project(projection).toArray();

        if (movies.length === 0) {
            return res.status(404).json({ error: "No matching movies found." });
        }

        res.status(200).json({ movies });
    } catch (error) {
        console.error("Error in multi-parameter read API:", error);
        res.status(500).json({ error: "Internal Server Error." });
    }
});

// Semantic search API
app.get("/api/semanticsearch/:query", async (req, res) => {
    try {
        const { query } = req.params;

        if (!query) {
            return res.status(400).json({ error: "Query parameter cannot be empty." });
        }

        // Generate embedding for the search query
        const queryEmbedding = await getEmbedding(query);

        // Define the vector search pipeline
        const pipeline = [
            {
                $vectorSearch: {
                    index: "vector_index",
                    queryVector: queryEmbedding,
                    path: "embedding",
                    exact: true,
                    limit: 10
                }
            },
            {
                $project: {
                    embedding: 0 // Exclude embedding field
                }
            }
        ];

        // Execute aggregation query
        const results = await moviesCollection.aggregate(pipeline).toArray();

        if (results.length === 0) {
            return res.status(404).json({ error: "No matching movies found." });
        }

        res.status(200).json({ movies: results });
    } catch (error) {
        console.error("Error in semantic search API:", error);
        res.status(500).json({ error: "Internal Server Error." });
    }
});

app.post('/movies/search', async (req, res) => {
    const { query, searchType, commonGenres } = req.body;
    let searchCriteria;

    if (searchType === 'title') {
        searchCriteria = { title: { $regex: query, $options: 'i' } };
    } else if (searchType === 'genre') {
        searchCriteria = { genres: { $regex: query, $options: 'i' } };
    } else {
        return res.status(400).send({ error: "Invalid search type" });
    }

    if (commonGenres && commonGenres.length > 0) {
        searchCriteria.genres = { $in: commonGenres };
    }

    try {
        const movies = await moviesCollection.find(searchCriteria).toArray();
        res.render('userSearch', { movies });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while searching for movies");
    }
});

// User multi-parameter query (frontend page)
app.post('/movies/search', async (req, res) => {
    const { title, director, genre, plotQuery } = req.body;
    const criteria = {};

    // Assemble query criteria
    if (title) criteria.title = { $regex: title, $options: 'i' };
    if (director) criteria.director = { $regex: director, $options: 'i' };
    if (genre) criteria.genres = { $in: genre.split(',').map(g => g.trim()) };

    try {
        let movies = [];
        if (plotQuery) {
            // Perform semantic search
            const queryEmbedding = await getEmbedding(plotQuery);
            const pipeline = [
                {
                    $vectorSearch: {
                        index: "vector_index",
                        queryVector: queryEmbedding,
                        path: "embedding",
                        exact: true,
                        limit: 10
                    }
                },
                {
                    $match: criteria // Apply other query criteria
                },
                {
                    $project: {
                        embedding: 0 // Exclude embedding field
                    }
                }
            ];
            movies = await moviesCollection.aggregate(pipeline).toArray();
        } else {
            // Regular query
            movies = await moviesCollection.find(criteria).toArray();
        }

        res.render('userSearch', { movies, user: req.user });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error occurred while searching for movies");
    }
});

// Admin multi-parameter query
app.post('/movies/admin/multi-search', ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { title, director, genre } = req.body;
    const criteria = {};

    if (title) criteria.title = { $regex: title, $options: 'i' };
    if (director) criteria.director = { $regex: director, $options: 'i' };
    if (genre) criteria.genres = { $in: genre.split(',').map(g => g.trim()) };

    try {
        const movies = await moviesCollection.find(criteria).toArray();
        res.render('admin-dashboard', { movies, user: req.user, error: movies.length === 0 ? "No movies found." : null });
    } catch (error) {
        console.error("Error in admin multi-search:", error);
        res.render('admin-dashboard', { movies: [], user: req.user, error: "An error occurred while searching for movies." });
    }
});

// Admin semantic search
app.post('/movies/admin/semantic-search', ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { plotQuery } = req.body;

    if (!plotQuery) {
        return res.render('admin-dashboard', { movies: [], user: req.user, error: "Please enter a plot description for semantic search." });
    }

    try {
        const queryEmbedding = await getEmbedding(plotQuery);
        const pipeline = [
            {
                $vectorSearch: {
                    index: "vector_index",
                    queryVector: queryEmbedding,
                    path: "embedding",
                    exact: true,
                    limit: 10
                }
            },
            {
                $project: {
                    embedding: 0 // Exclude embedding field
                }
            }
        ];

        const movies = await moviesCollection.aggregate(pipeline).toArray();
        res.render('admin-dashboard', { movies, user: req.user, error: movies.length === 0 ? "No movies found." : null });
    } catch (error) {
        console.error("Error in admin semantic search:", error);
        res.render('admin-dashboard', { movies: [], user: req.user, error: "An error occurred while performing semantic search." });
    }
});

const PORT = process.env.PORT || 8099;
const server = app.listen(PORT, () => {
    console.log(`The server runs on http://localhost:${PORT}`)
});

process.on("SIGINT", async () => {
    console.log("Closing MongoDB connections...");
    await userClient.close();
    await movieClient.close();
    server.close(() => {
        console.log("Server shut down");
        process.exit(0);
    });
});
