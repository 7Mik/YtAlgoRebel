const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    background: './extension/src/background/background.js',
    content: './extension/src/content/content.js',
    inject: './extension/src/content/inject.js',
    popup: './extension/src/popup/popup.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'extension/manifest.json', to: 'manifest.json' },
        { from: 'extension/assets', to: 'assets', noErrorOnMissing: true },
        { from: 'extension/_locales', to: '_locales' },
        { from: 'extension/src/popup/popup.html', to: 'popup.html' },
        { from: 'extension/src/popup/popup.css', to: 'popup.css' },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js'],
  },
};
