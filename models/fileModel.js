const mongoose = require('mongoose');

//connect once for the whole app (dotevn is already loaded at the top of index.js)
mongoose.connect(process.env.MONGO_URL)
    .then(() => {
        console.log("Model connected");
    })
    .catch((err) => {
        console.log("Model connection error",err);
    })

const fileSchema = new mongoose.Schema({
    filename:{
        type: String,
        required: true
    },
    description:{
        type: String,
        default: ''
    },
    category:{
        type: String,
        default: 'General'
    },
    owner:{
        type: mongoose.Schema.Types.ObjectId,   //Each file needs to remember who created it, so every route can filter by it.
        required: true,
        ref: 'login'
    }
});

fileSchema.index({owner:1, filename:1}, {unique:true});

module.exports = mongoose.model('File', fileSchema);