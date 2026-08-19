/**
 * Builds the Android APK.
 *
 *   node scripts/apk.mjs            -> debug apk (installable straight away)
 *   node scripts/apk.mjs --release  -> unsigned release apk
 *
 * Finds the Android SDK itself and writes android/local.properties, so a fresh
 * clone only needs Android Studio's SDK + a JDK on the machine.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const release = process.argv.includes('--release');

function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.HOME && join(process.env.HOME, 'Android', 'Sdk'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(join(p, 'platforms')));
}

/** Capacitor 8 needs JDK 21+. Android Studio ships one, so borrow it if needed. */
function javaMajor(home) {
  try {
    const release = readFileSync(join(home, 'release'), 'utf8');
    const m = release.match(/JAVA_VERSION="?(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function findJdk() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:/Program Files/Android/Android Studio/jbr',
    'C:/Program Files/Android/Android Studio Preview/jbr',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Android Studio', 'jbr'),
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    process.env.HOME && join(process.env.HOME, 'android-studio', 'jbr'),
  ].filter(Boolean);
  return candidates.find((p) => javaMajor(p) >= 21);
}

if (!existsSync(androidDir)) {
  console.error('No android/ folder. Run:  npx cap add android');
  process.exit(1);
}

const sdk = findSdk();
if (!sdk) {
  console.error(
    'Android SDK not found. Install it via Android Studio, or set ANDROID_HOME.',
  );
  process.exit(1);
}

writeFileSync(join(androidDir, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '/')}\n`);
console.log(`SDK: ${sdk}`);

const jdk = findJdk();
if (!jdk) {
  console.error(
    "No JDK 21+ found. Install one, or point JAVA_HOME at Android Studio's bundled jbr folder.",
  );
  process.exit(1);
}
console.log(`JDK: ${jdk}`);

const task = release ? 'assembleRelease' : 'assembleDebug';
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
console.log(`Running ${gradlew} ${task} (first run downloads Gradle — be patient)…`);

execFileSync(join(androidDir, gradlew), [task], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, JAVA_HOME: jdk },
});

const built = join(
  androidDir,
  'app',
  'build',
  'outputs',
  'apk',
  release ? 'release' : 'debug',
  release ? 'app-release-unsigned.apk' : 'app-debug.apk',
);
if (!existsSync(built)) {
  console.error(`Gradle finished but ${built} is missing.`);
  process.exit(1);
}

const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, release ? '147-release-unsigned.apk' : '147-debug.apk');
copyFileSync(built, out);
console.log(`\nAPK: ${out}`);
