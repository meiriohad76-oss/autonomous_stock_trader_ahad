# Pi Fundamentals Recovery

When Pi access returns, deploy the latest fundamentals + screener files from Windows:

```powershell
cd "C:\Users\meiri\OneDrive\Documents\trading system"
.\scripts\deploy-pi-fundamentals.ps1 -PiHost ahad@10.100.102.23
```

If the LAN IP still fails, try the Pi's current reachable address instead.

After the copy completes, run on the Pi:

```bash
sudo systemctl restart sentiment-analyst.service
sleep 3
sudo systemctl status sentiment-analyst.service --no-pager -l
curl -s http://127.0.0.1:3000/api/fundamentals/dashboard | grep -o '"screener"\|"initial_screen"'
curl -s http://127.0.0.1:3000/api/health
```

What should change after restart:

- `Coverage` should grow beyond the 6-name demo universe.
- `/api/fundamentals/dashboard` should include top-level `screener`.
- leaderboard rows should include `initial_screen`.
- `fundamentals.html` should show the screener UI and `Screen` column.

Notes:

- The app now loads the broader `S&P 100 + QQQ Holdings` universe during startup without creating scored placeholder fundamentals.
- Live SEC enrichment will continue to improve those names after boot, so the first post-restart snapshot may broaden immediately and then get more detailed over time.
