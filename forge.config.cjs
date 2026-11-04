const path = require('node:path');
const { version } = require('./package.json');

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'ClothingSwapStudio',
    extraResource: [path.resolve(__dirname, 'assets', 'backgrounds')],
    ignore: [/^\/out($|\/)/, /^\/test($|\/)/]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'clothing_swap_studio',
      setupExe: `Clothing-Swap-Studio-Setup-${version}.exe`,
        authors: 'SSG Design',
        description: '제품 이미지 기반 정밀 의상 교체 데스크톱 앱'
      }
    }
  ]
};
