const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const fileModel = require('./models/model');

app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({extended:true}));

app.get('/', function(req,res){
    // res.send("Hello");
    fs.readdir('./files', function(err,files){
        res.render("index", {files});
    })
})

app.post('/create', function(req,res){
    // fs.writeFile(`./files/${req.body.title.split(' ').join('')}.txt`, req.body.details, function(err){
    //     if(err){
    //         res.send("error occured");
    //     }else{
    //         res.redirect('/');
    //     }
    // });
    const filename = `${req.body.title.split(' ').join('')}.txt`;
    const details = req.body.details;
    const category = req.body.category || "General";   //Logical OR operator

    fs.writeFile(`./files/${filename}`, details, async function(err){
        if(err){
            return res.status(500).send("Error occured");
        }
        try{
            await fileModel.create({
                filename: filename,
                description: details,
                category: category
            });
            res.redirect('/');
        } catch(error){
            console.error("MongoDB error", error);
            res.status(500).send(`File created but metadata could not be saved, ${error}`);
        }
    });
});

app.get('/metadata', async (req,res)=>{
    try{
        const files = await fileModel.find();
        res.json(files);
    } catch(error){
        console.error("Error fetching metadata:", error);
        res.status(500).send("Error fetching metadata")
    }
})

app.get('/file/:filename', function(req,res){
    fs.readFile(`./files/${req.params.filename}`, "utf-8", function(err, fileData){
        res.render('show', {
            filename:req.params.filename, 
            fileData:fileData});
    })
})

app.get('/edit/:filename', function(req,res){
    res.render('edit', {
        filename:req.params.filename
    })
})

app.post('/edit', function(req,res){
    fs.rename(`./files/${req.body.previous}`, `./files/${req.body.new}.txt`, function(err){
        if(err) return res.send("can't change name");
        res.redirect('/');
    })
})

app.get('/delete/:filename', function(req,res){
    res.render('delete', {filename: req.params.filename})
})

app.post('/delete', function(req,res){
    fs.unlink(`./files/${req.body.deletefile}`, function(err){
        if(err) return res.send("Can't delete");
        res.redirect('/');
    })
})

app.get('/search', function(req,res){
    // res.send('filename');
    fs.readdir('./files', function(err,files){
        if(err) return res.send("Error occured");

        const found = files.filter(function(file){
            return file.includes(req.query.search);
        });
        // if(found) res.send(found);
        // else res.send("File not found");
        res.render('index', {files: found})
    })
})

app.get('/download/:filename', function(req,res){
    const filepath = path.join(__dirname, 'files', req.params.filename);
    res.download(filepath);
})
 
app.listen(3001);
