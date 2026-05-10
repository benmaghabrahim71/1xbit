const app = require('./server');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`🚀 Server and Frontend are running simultaneously on port ${PORT}`);
    console.log(`🌍 Access the website at http://localhost:${PORT}`);
});
