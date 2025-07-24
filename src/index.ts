import app from './arxiv-server';

// Start the server
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Parrot Agent server running on port ${PORT}`);
});
