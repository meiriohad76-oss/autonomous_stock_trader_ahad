# PostgreSQL Setup

This app already supports PostgreSQL. What is missing on this machine right now is the PostgreSQL server itself.

## Current state

- `psql` is not installed
- no local PostgreSQL Windows service is running
- the app is still configured to use `sqlite`

## 1. Install PostgreSQL on Windows

Use the official PostgreSQL Windows installer:

- Official page: `https://www.postgresql.org/download/windows/`
- Click `Download the installer`
- Use the current Windows x64 installer from EDB

In the installer:

1. Keep the default install directory
2. Keep these components enabled:
   - `PostgreSQL Server`
   - `pgAdmin 4`
   - `Command Line Tools`
3. Keep the default data directory
4. Set a password for the `postgres` superuser and save it
5. Keep the port as `5432`
6. Finish the installation

## 2. Create the app database

Open `SQL Shell (psql)` from the Start menu.

Use:

- Server: `localhost`
- Database: `postgres`
- Port: `5432`
- Username: `postgres`
- Password: the one you chose during install

Then run:

```sql
CREATE USER sentiment_app WITH PASSWORD 'YourStrongPassword123!';
CREATE DATABASE sentiment_analyst OWNER sentiment_app;
GRANT ALL PRIVILEGES ON DATABASE sentiment_analyst TO sentiment_app;
```

If the user already exists:

```sql
ALTER USER sentiment_app WITH PASSWORD 'YourStrongPassword123!';
```

## 3. Update `.env`

Edit [.env](</C:/Users/meiri/OneDrive/Documents/autonomous%20trader/.env>) and change these lines:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://sentiment_app:YourStrongPassword123!@127.0.0.1:5432/sentiment_analyst
```

Keep `DATABASE_ENABLED=true`.

If your password contains characters like `@`, `:`, `/`, or `#`, URL-encode them before putting the password in `DATABASE_URL`.

## 4. Verify the database connection

From the project root run:

```cmd
cd /d "C:\Users\meiri\OneDrive\Documents\autonomous trader" && node scripts\postgres-smoke.js
```

Expected result:

- `database_provider` is `postgres`
- `schema_tables_present` is `10`
- `version` returns a PostgreSQL version string

The script also initializes the schema automatically if the database is reachable.

## 5. Start the app on PostgreSQL

Once the smoke test passes:

```cmd
cd /d "C:\Users\meiri\OneDrive\Documents\autonomous trader" && node src\server.js
```

Then check:

- terminal output should say `Persistence provider: postgres`
- dashboard `System` tab should show `Database: postgres`

## Helpful checks

Check whether PostgreSQL is installed:

```cmd
where psql
```

Check whether the local service is running:

```powershell
Get-Service | Where-Object { $_.Name -like 'postgres*' -or $_.DisplayName -like '*PostgreSQL*' }
```
