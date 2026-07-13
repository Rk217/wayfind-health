# Wayfind Health

A Node.js Express appointment booking app with SQLite.

## Deploying permanently

### Option 1: Deploy to Render
1. Create a GitHub repo and push this project.
2. Sign in to Render and create a new Web Service.
3. Connect your GitHub repo.
4. Set the build command to:
   ```bash
   npm install
   ```
5. Set the start command to:
   ```bash
   npm run start
   ```
6. Render will provide a permanent URL like `https://your-app.onrender.com`.

### Option 2: Deploy to Railway
1. Create a GitHub repo and push this project.
2. Sign in to Railway and create a new project.
3. Connect your GitHub repo.
4. Railway will detect Node.js and install dependencies.
5. Confirm the start command:
   ```bash
   npm run start
   ```
6. Railway will provide a permanent URL like `https://your-app.up.railway.app`.

## Local setup

```bash
cd C:\Users\RITEEK\Desktop\game\wayfind-health-app
npm install
npm run start
```

Open in browser:
- `http://localhost:3000`
- `http://localhost:3000/admin.html`

## Notes

- The app uses `better-sqlite3`, so deploy with Node 18.x or install build tools.
- The default admin account is `admin` / `admin123` on first run.
- SQLite data is stored in `data/wayfind.db`.
