import app from './arxiv-server';

// Start the server
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Arxiv Agent server running on port ${PORT}`);
});
