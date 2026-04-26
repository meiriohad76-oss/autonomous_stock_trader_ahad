# GitHub + Pi Setup

This project can use GitHub as the source of truth, with the Raspberry Pi pulling updates directly from the same repo.

## Simple version

1. Create a **private GitHub repo**.
2. From this project folder on Windows:
   - add the GitHub repo as `origin`
   - commit the code
   - push to `main`
3. On the Pi:
   - create an SSH deploy key
   - add the public key to the GitHub repo as a **read-only deploy key**
   - clone the repo
4. After that, the update flow becomes:
   - Windows: `git add .`, `git commit -m "..."`, `git push`
   - Pi: `git pull`, then restart the service

## Detailed version

### 1. Create the GitHub repo

- In GitHub, create a new **private** repository.
- Do **not** initialize it with a README, `.gitignore`, or license because this folder already contains files.

Example repo:

```text
https://github.com/YOUR_USER/sentiment-analyst
```

### 2. Connect this local folder to GitHub

Run these commands in PowerShell from this project root:

```powershell
cd "C:\Users\meiri\OneDrive\Documents\trading system"
git add .
git commit -m "Initial trading system import"
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

If `git commit` says your name/email is not configured, set them once:

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### 3. Create a deploy key on the Pi

SSH into the Pi and run:

```bash
mkdir -p ~/.ssh
ssh-keygen -t ed25519 -C "pi-deploy-key" -f ~/.ssh/github_pi_deploy
cat ~/.ssh/github_pi_deploy.pub
```

Copy the printed public key.

In GitHub:

- open the repo
- go to `Settings`
- go to `Deploy keys`
- choose `Add deploy key`
- paste the public key
- leave write access disabled

### 4. Configure the Pi to use GitHub over SSH

On the Pi, add this SSH config:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_pi_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
chmod 600 ~/.ssh/github_pi_deploy
chmod 644 ~/.ssh/github_pi_deploy.pub
```

Test the connection:

```bash
ssh -T git@github.com
```

GitHub may respond with a message like:

```text
Hi USER/REPO! You've successfully authenticated...
```

That is enough.

### 5. Clone the repo on the Pi

If the project is not already in place on the Pi:

```bash
git clone git@github.com:YOUR_USER/YOUR_REPO.git ~/sentiment-analyst
cd ~/sentiment-analyst
npm install
```

If the folder already exists and you want to convert it later, it is usually safer to back it up first and then reclone cleanly.

### 6. Point the service at the cloned repo

If your service already uses:

```text
/home/ahad/sentiment-analyst
```

and you clone into that same directory, you may not need to change anything.

Check the service:

```bash
sudo systemctl cat sentiment-analyst.service
```

If needed:

```bash
sudo systemctl edit --full sentiment-analyst.service
```

Make sure `WorkingDirectory` and `ExecStart` point at the cloned repo.

Then reload:

```bash
sudo systemctl daemon-reload
sudo systemctl restart sentiment-analyst.service
```

### 7. Day-to-day workflow

On Windows:

```powershell
git add .
git commit -m "Describe the change"
git push
```

On the Pi:

```bash
cd ~/sentiment-analyst
git pull
npm install
sudo systemctl restart sentiment-analyst.service
```

Only run `npm install` when `package.json` or `package-lock.json` changed.

### 8. Useful checks

On Windows:

```powershell
git status
git remote -v
```

On the Pi:

```bash
cd ~/sentiment-analyst
git status
git log --oneline -5
```

### 9. Notes for this repo

This repo already ignores:

- `.env`
- `node_modules/`
- SQLite database files
- SQLite backup files
- `dist/`

That means your runtime database and local backups stay on the Pi and do not get pushed to GitHub.
