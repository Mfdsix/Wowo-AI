module.exports = {
  apps: [
    {
      name: "wowo-ai",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -H 0.0.0.0 -p 3001",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
      max_memory_restart: "500M",
      autorestart: true,
    },
  ],
};