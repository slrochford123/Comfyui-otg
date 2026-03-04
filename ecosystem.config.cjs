/** @type {import("pm2").EcosystemConfig} */
module.exports = {
  apps: [
    {
      name: "otg-prod",
      cwd: "C:/AI/OTG-PROD",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
    {
      name: "otg-test",
      cwd: "C:/AI/OTG-TEST/OTG",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3001",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
    },
  ],
};
