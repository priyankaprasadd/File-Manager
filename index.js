require('dotenv').config()
const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const fileModel = require('./models/fileModel');
const loginModel = require('./models/loginModel');
const bcrypt = require('bcrypt')
const session = require('express-session')
const MongoStore = require('connect-mongo').default || require('connect-mongo')

app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({extended:true}));

//session middleware
app.use(session({
    secret: process.env.SESSION_SECRET,  //signs the session cookie so it can't be forged(illegally copied)
    resave: false,                       //don't resave a session that hasn't changed yet
    saveUninitialized: false,            //don't store empty sessions for visitors who haven't logged in 
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URL  //sessions live in mongoDb, so nodemon restarts don't logged you out
    }),
    cookie:{
        httpOnly: true,               //javascript in the page can't read the cookie
        sameSite: 'lax',              //blocks most cross-site request tricks  
        secure: false,                //set to true only when you deploy on https
        maxAge: 1000*60*60*24         //i day in milliseconds
    }
}))

//requireLogin middleware - it will prevent file routes from open to everyone
//only registered user can view files
function requireLogin (req, res, next){
    if(req.session.userId){
        return next();
    } 
    res.redirect('/login');
}

function redirectIfLoggedIn(req,res,next){
    if(req.session.userId){
        return res.redirect('/')
    }
    next();
}

//helper function
function safeName(requestedName) {
    if(typeof requestedName !== 'string' || requestedName.trim() === '') return null;
    // const requestedName = req.params.name;
    const cleanName = path.basename(requestedName);
    if(requestedName !== cleanName) return null;
    if (cleanName === '.' || cleanName === '..') return null;
    return cleanName;
}

function userPath(userId){
    return path.join(__dirname, 'files', userId);
}

app.get('/', requireLogin, function(req,res){
    const userFolder = userPath(req.session.userId);
    fs.readdir(userFolder, function(err,files){
        if(err){
            if(err.code === 'ENOENT') return res.render("index", {files:[], selectedCategory:"All"});
            console.log("Can't load slash route", err)
            return res.status(500).send("Can't load slash route")
        }
        res.render("index", {files, selectedCategory:"All"});
    })
}) 

app.post('/create', requireLogin, function(req,res){
    const file = safeName((req.body.title || '').split(' ').join(''));
    if (!file) return res.status(400).send("Invalid Filename");
    const filename = file + '.txt';

    const userFolder = userPath(req.session.userId);
    const userId = req.session.userId;

    const filepath = path.join(userFolder, filename);
    const details = req.body.details || "";
    const category = req.body.category || "General";   //Logical OR operator

    fs.mkdir(userFolder, {recursive: true}, (err) => {
        if(err){
            console.error("Error occured", err);
            return res.status(500).send(`Error occured`);
        } 
        fs.writeFile(filepath, details, async function (err) {
            if (err) {
                return res.status(500).send("Error occured");
            }
            try {
                await fileModel.findOneAndUpdate(
                    {owner: userId, filename},
                    {$set: {owner: userId, description:details, category}},
                    {upsert: true, new: true}
                );
                res.redirect('/');
            } catch (error) {
                console.error("MongoDB error", error);
                res.status(500).send(`File created but metadata could not be saved`);
            }
        });
    })
})

app.get('/metadata',requireLogin,  async (req,res)=>{
    try{
        const userId = req.session.userId;
        const files = await fileModel.find({owner: userId});
        res.json(files);
    } catch(error){
        console.error("Error fetching metadata:", error);
        res.status(500).send("Error fetching metadata")
    }
})

app.get('/filter-category', requireLogin, async(req,res)=>{
    try{
        const userId = req.session.userId;
        const selectedCategory = String(req.query.category || "All");
        // const query = {owner: userId};

        const files = (selectedCategory === "All"
            ? await fileModel.find({owner: userId})
            : await fileModel.find({owner: userId, category: selectedCategory })
        ).filter(file =>
            fs.existsSync(path.join(userPath(userId), file.filename))
        );

        res.render('index', {
            files,
            selectedCategory
        });
    } catch(error){
        console.error("Error fetching categorised files",error)
        res.status(500).send(`Error fetching categorised files`)
    }
})

app.get('/file/:filename', requireLogin, function(req,res){
    const cleanName = safeName(req.params.filename);
    if (!cleanName) return res.status(400).send("Invalid Filename");
    const userFolder = userPath(req.session.userId);
    const filepath = path.join(userFolder, cleanName);
    fs.readFile(filepath, "utf-8", function(err, fileData){
        if(err){
            return res.status(404).send("File not found")
        }
        res.render('show', {
            filename:cleanName, 
            fileData:fileData
        });
    })
})

app.get('/edit/:filename', requireLogin, function(req,res){
    const filename = safeName(req.params.filename);
    if(!filename) return res.status(400).send("Invalid filename");
    const userId = req.session.userId
    const filePath = path.join(userPath(userId), filename);
    if(!fs.existsSync(filePath)) return res.status(404).send("File not found");
    res.render('edit', {filename})
})

app.post('/edit', requireLogin, function(req,res){
    const previousName = safeName(req.body.previous);
    if (!previousName) return res.status(400).send("Invalid Filename");
    const newName = safeName((req.body.new || "").split(' ').join(''));
    if (!newName) return res.status(400).send("Invalid Filename");
    const newFileName = newName + '.txt';
    const userId = req.session.userId;
    const previousPath = path.join(userPath(userId), previousName);
    const newPath = path.join(userPath(userId), newFileName);

    //rename would silently overwrite an existing file
    if(fs.existsSync(newPath)){
        return res.status(409).send("A file with that name already exists");
    }

    fs.rename(previousPath, newPath, async function(err){
        if(err) {
            if(err.code === 'ENOENT'){
                return res.status(404).send("File not found")
            }
            console.error(`Rename error: ${err}`);
            return res.status(500).send(`can't change name`);
        }
        try{
            await fileModel.findOneAndUpdate(
                {owner:userId, filename: previousName},
                {$set: {filename: newFileName}}
            )
            res.redirect('/');
        } catch(error){
            console.error(`MongoDB edition error: ${error}`)
            res.status(500).send("File renamed, but MongoDB metadata could not be updated")
        }
    })
})

app.get('/delete/:filename', requireLogin, function(req,res){
    const filename = safeName(req.params.filename);
    if (!filename) return res.status(400).send("Invalid Filename");

    const filepath = path.join(userPath(req.session.userId), filename);
    if (!fs.existsSync(filepath)) return res.status(404).send("File not found");

    res.render('delete', { filename: filename });
})

app.post('/delete', requireLogin, function(req,res){
    const filename = safeName(req.body.deletefile);
    if (!filename) return res.status(400).send("Invalid Filename");
    const userId = req.session.userId;
    const filepath = path.join(userPath(userId), filename);

    fs.unlink(filepath, async function(err){
        if(err){
            //ENOENT means the file does not exist
            if(err.code === 'ENOENT'){
                return res.status(404).send("File not found");
            }
            console.error(`File deletion error: ${err}`);
            return res.status(500).send("Can't delete");
        } 
        try{
            //deleteone + owner: only this user's record is removed
            await fileModel.deleteOne({owner:userId, filename: filename});
            res.redirect('/');
        } catch (error){
            console.error(`MongoDB deletion error: ${error}`)
            res.status(500).send("File deleted but MongoDB metadata could not be deleted");
        }
    })
})

app.get('/search', requireLogin, function(req,res){
    const userId = req.session.userId;
    fs.readdir(userPath(userId), function(err,files){
        if(err) {
            if(err.code === 'ENOENT'){
                return res.render('index', {files:[], selectedCategory: "All"})
            }
            console.error(`Search error: ${err}`);
            return res.status(500).send("Error occured");
        }
        const found = files.filter(function(file){
            return file.includes(String(req.query.search || ""));
        });
        res.render('index', {files: found, selectedCategory:"All"})
    })
})

app.get('/download/:filename', requireLogin, function(req,res){
    const filename = safeName(req.params.filename);
    if(!filename) return res.status(400).send("Invalid Filename");
    const userFolder = userPath(req.session.userId)
    const filepath = path.join(userFolder, filename);
    res.download(filepath, function(err){
        // res.headersSent is true once a response has already started, so you don't send a second one.
        if(err && !res.headersSent){
            res.status(404).send("File not found");
        }
    });
})

app.get('/signup', redirectIfLoggedIn, (req,res)=>{
    res.render('signup', {error: null});
})

app.post('/signup', redirectIfLoggedIn, async (req,res)=>{
    try{
        const email = (req.body.email || "").trim().toLowerCase();
        const password = req.body.password;
        if(!email || !password) return res.status(400).render('signup', {error: "Enter complete details"}); 
        if(password.length < 8) return res.status(400).render('signup', {error: "Password must be 8 characters long"});
        const existingEmail = await loginModel.findOne({email});
        if(existingEmail){
            return res.status(409).render('signup', {error: "User already exists"});
        }
        // // bcrypt.genSalt(10, async (err, salt) => {
        // bcrypt.hash(password, 10, async (err, hash) => {
        //     await loginModel.create({
        //         email,
        //         password: hash
        //     });
        //     res.redirect('/login');
        // });
        // // })
        const hash = await bcrypt.hash(password, 10);
        await loginModel.create({email, password: hash});
        res.redirect('/login');
    } catch(err){
        console.log(`Signup Error, ${err}`);
        if(err.code === 11000){
            return res.status(409).render('signup', {error: "User already exists"})
        }
        res.status(500).render('signup', {error: "Something went wrong"});
    }
})

app.get('/login', redirectIfLoggedIn, (req,res)=>{
    res.render('login', {error: null});
})

app.post('/login', redirectIfLoggedIn, async (req,res)=>{
    try{
        const email = (req.body.email || "").trim().toLowerCase();
        const password = req.body.password;
        if(!email || !password) return res.status(400).render('login', {error: "Enter complete details"}); 
        const user = await loginModel.findOne({email});
        if(!user){
            return res.status(401).render('login', {error: "Invalid email or password"});
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch){
            return res.status(401).render('login', {error: "Invalid email or password"});
        }
        //create a fresh session id
        req.session.regenerate((err) => {
            if(err){
                console.log(`Session regenerate error, ${err}`)
                return res.status(500).render('login', {error: "Something went wrong"})
            }
            //store only email on the new session
            // req.session.userEmail = email;
            req.session.userId = user._id.toString()

            //write the session to mongoDB, then redirect
            req.session.save((err) => {
                if(err){
                    console.log(`Session save error, ${err}`)
                    return res.status(500).render('login', {error: "Something went wrong"})
                }
                res.redirect('/')
            })
        })
    } catch(err){
        console.log(`Login Error, ${err}`);
        res.status(500).render('login', {error: "Something went wrong"});
    }
})

app.post('/logout', requireLogin, (req,res) => {
    req.session.destroy((err) => {  //'destroy' deletes the session from MongoDB
        if(err){
            console.log(`Logout error, ${err}`);
            return res.status(500).send("Could not log out");
        }
        res.clearCookie('connect.sid');    //'clearCookie' removes the cookie from the browser
        res.redirect('/login');
    })
})

app.listen(3001);
