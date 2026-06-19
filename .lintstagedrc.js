const isWin = process.platform === 'win32';

module.exports = {
  '*.js': isWin ? ['prettier --write'] : ['eslint --fix', 'prettier --write'],
  '*.{json,css,md}': ['prettier --write'],
};
