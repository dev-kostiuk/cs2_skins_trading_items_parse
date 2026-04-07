module.exports = {
    apps: [
        {
            name: "dmarket-items-daemon",
            script: "./dmarket.js",
            instances: 1,
            autorestart: true,
            time: true,
            out_file: "./logs/dmarket.out.log",
            error_file: "./logs/dmarket.err.log",
            merge_logs: true,
            env: { NODE_ENV: "production" },
        },
        {
            name: "whitemarket-items-daemon",
            script: "./whitemarket.js",
            instances: 1,
            autorestart: true,
            time: true,
            out_file: "./logs/whitemarket.out.log",
            error_file: "./logs/whitemarket.err.log",
            merge_logs: true,
            env: { NODE_ENV: "production" },
        },
    ],
};
