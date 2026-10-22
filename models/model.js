const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/filemanager')
    .then(() => {
        console.log("Model connected");
    })
    .catch((err) => {
        console.log("Model connection error",err);
    })

const fileSchema = mongoose.Schema({
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
    }
})

module.exports = mongoose.model('user', fileSchema);