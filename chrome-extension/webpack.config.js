const path = require("path")
const fs = require("fs")

/** Minimal plugin to copy the popup HTML to the output popup/ directory. */
class CopyPopupHtmlPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("CopyPopupHtmlPlugin", () => {
      const src = path.resolve(__dirname, "src/popup/popup.html")
      const dest = path.resolve(__dirname, "popup/popup.html")
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
    })
  }
}

/** @type {import('webpack').Configuration} */
module.exports = {
  entry: {
    background: "./src/background.ts",
    content: "./src/content.ts",
    popup: "./src/popup/popup.ts",
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
  plugins: [new CopyPopupHtmlPlugin()],
}
