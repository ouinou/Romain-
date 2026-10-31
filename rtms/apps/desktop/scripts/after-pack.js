// Après l'assemblage : icône RAHA et informations de version dans l'exécutable Windows.
// Remplace rcedit (qui exige Wine sous Linux) par resedit, écrit en JavaScript.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { NtExecutable, NtExecutableResource, Resource, Data } = ResEdit;
  const exeName = `${ctx.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(ctx.appOutDir, exeName);
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);
  const iconFile = Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconFile.icons.map((i) => i.data));
  const [vi] = Resource.VersionInfo.fromEntries(res.entries);
  const version = ctx.packager.appInfo.version.split('.').map(Number);
  vi.setFileVersion(...version, 0, 1033);
  vi.setProductVersion(...version, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'RAHA TRANSPORT Management System',
    ProductName: 'RAHA TRANSPORT RTMS',
    CompanyName: 'RAHA TRANSPORT',
    LegalCopyright: `© ${new Date().getFullYear()} RAHA TRANSPORT`,
    OriginalFilename: exeName,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • icône et version appliquées à ${exeName}`);
};
