const path = require("path")
const fs = require("fs")
const webpack = require("webpack")

const extensionDefaultOrigin =
  process.env.HIREOVEN_EXTENSION_DEFAULT_ORIGIN ||
  (process.env.HIREOVEN_EXTENSION_TARGET === "production"
    ? "https://hireoven.com"
    : "http://localhost:3000")

/** Minimal plugin to copy static HTML entry points next to their bundles. */
class CopyStaticHtmlPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("CopyStaticHtmlPlugin", () => {
      const pairs = [
        ["src/popup/popup.html", "popup/popup.html"],
        ["src/onboarding/onboarding.html", "onboarding/onboarding.html"],
      ]
      for (const [srcRel, destRel] of pairs) {
        const src = path.resolve(__dirname, srcRel)
        const dest = path.resolve(__dirname, destRel)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
      }
    })
  }
}

/** @type {import('webpack').Configuration} */
module.exports = {
  entry: {
    background: "./src/background.ts",
    content: "./src/content.ts",
    popup: "./src/popup/popup.ts",
    onboarding: "./src/onboarding/onboarding.ts",
    "content/aggregators/linkedin/handler": "./src/content/aggregators/linkedin/handler.ts",
    "content/aggregators/glassdoor/handler": "./src/content/aggregators/glassdoor/handler.ts",
    "content/aggregators/indeed/handler": "./src/content/aggregators/indeed/handler.ts",
    "content/aggregators/handshake/handler": "./src/content/aggregators/handshake/handler.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  // Chrome extensions run in isolated contexts — no need for source maps in production.
  devtool: process.env.NODE_ENV === "development" ? "inline-source-map" : false,
  // Prevent webpack from inlining chunk loading code that breaks MV3 service workers.
  optimization: {
    runtimeChunk: false,
  },
  plugins: [
    new webpack.DefinePlugin({
      __HIREOVEN_EXTENSION_DEFAULT_ORIGIN__: JSON.stringify(extensionDefaultOrigin),
    }),
    new CopyStaticHtmlPlugin(),
  ],
}
