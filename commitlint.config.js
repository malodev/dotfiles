/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow longer subjects (up to 120 chars) for this repo
    'subject-max-length': [2, 'always', 120],
    // Scopes commonly used in this dotfiles repo
    'scope-enum': [0], // allow any scope — too many packages to enumerate
  },
};
