const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const process = require("process");
const yaml = require('js-yaml');
const uuid = require('uuid');
const { platform } = require('os');

const UPLOAD_FOLDER = path.join(process.resourcesPath, 'uploads');
const OUTPUTS_FOLDER = path.join(process.resourcesPath, 'outputs');
const DEFAULT_KEYSTORE_PATH = path.join(process.resourcesPath, 'utils', 'cert', 'keystore.jks')
fs.mkdirSync(UPLOAD_FOLDER, { recursive: true });
fs.mkdirSync(OUTPUTS_FOLDER, { recursive: true });
const apktoolPath = path.join(process.resourcesPath, 'utils', 'apktool_2.9.3.jar');
const uberApkSignerPath = path.join(process.resourcesPath, 'utils', 'uber-apk-signer-1.2.1.jar');
const apkDataPath = path.join(process.resourcesPath, 'apkdata')
//const javaWinBin = path.join(process.resourcesPath, 'utils', 'java-win', 'bin', 'java.exe')

function cmd(...command) {
    currentOs = process.platform;
    switch (currentOs) {
        case "darwin":
            javaBinPath = path.join(process.resourcesPath, 'utils', 'java-darwin', 'bin', 'java')
            break
        case "win32":
            javaBinPath = path.join(process.resourcesPath, 'utils', 'java-win', 'bin', 'java.exe')
            break
        case "linux":
            javaBinPath = path.join(process.resourcesPath, 'utils', 'java-nix', 'bin', 'java')
            break
    }
    let p = spawn(javaBinPath, command.slice(0));
    return new Promise((resolve) => {
        p.stdout.on("data", (x) => {
            process.stdout.write(x.toString());
        });
        p.stderr.on("data", (x) => {
            process.stderr.write(x.toString());
        });
        p.on("exit", (code) => {
            resolve(code);
        });
    });
}

async function generateApk(packageName, versionCode, versionName, sizeApk, keystorePath, keystoreAlias, keystoreKeypass, keystorePass) {
    const uniqueId = uuid.v4();
    const assetsDir = path.join(process.resourcesPath, 'apkdata', 'assets', uniqueId);
    fs.mkdirSync(assetsDir, { recursive: true });
    const apkName = `${packageName}_${versionCode}_${versionName}.apk`;
    const outputApk = path.join(OUTPUTS_FOLDER, apkName);

    try {
        await editApktoolConf(packageName, versionCode, versionName);
        if (sizeApk > 0) {
            const tempFilePath = path.join(assetsDir, 'outputfile.tempfile');
            fs.writeFileSync(tempFilePath, Buffer.alloc(sizeApk * 1024 * 1024 - 113999));
        }
        await cmd("-jar", apktoolPath, "b", apkDataPath, "--use-aapt2", "-o", outputApk)
        await cmd("-jar", uberApkSignerPath, "-a", outputApk, "--ks", keystorePath, "--ksAlias", keystoreAlias, "--ksKeyPass", keystoreKeypass, "--ksPass", keystorePass)
        return outputApk;
    } catch (error) {
        throw error;
    } finally {
        if (fs.existsSync(assetsDir)) fs.rmSync(assetsDir, { recursive: true });
        if (fs.existsSync(keystorePath)) fs.unlinkSync(keystorePath);
    }
}

async function editApktoolConf(packageName, versionCode, versionName) {
    const configPath = path.join(process.resourcesPath, 'apkdata', 'apktool.yml');
    let data = yaml.load(fs.readFileSync(configPath, 'utf8'));
    data.packageInfo.renameManifestPackage = packageName;
    data.versionInfo.versionCode = versionCode;
    data.versionInfo.versionName = versionName;
    fs.writeFileSync(configPath, yaml.dump(data));
}


app.whenReady().then(() => {
    const win = new BrowserWindow({
        icon: path.join(process.resourcesPath, 'images', 'icon.png'),
        width: 600,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false
        }
    });
    win.loadFile('src/index.html');

    ipcMain.handle('generate-apk', async (event, args) => {
        try {
            const { packageName, versionCode, versionName, sizeApk, keystoreFile, keystoreAlias, keystoreKeypass, keystorePass } = args;
            var apkPath = ''
            if(keystoreFile != null) {
                const keystorePath = path.join(UPLOAD_FOLDER, `${uuid.v4()}`);
                fs.writeFileSync(keystorePath, Buffer.from(keystoreFile.buffer));
                apkPath = await generateApk(packageName, versionCode, versionName, sizeApk, keystorePath, keystoreAlias, keystoreKeypass, keystorePass);
            }
            else {
                apkPath = await generateApk(packageName, versionCode, versionName, sizeApk, DEFAULT_KEYSTORE_PATH, 'mainkey', 'password', 'password');
            }
            const { filePath } = await dialog.showSaveDialog({
                title: 'Save APK',
                defaultPath: path.basename(apkPath),
                filters: [{ name: 'Android Package', extensions: ['apk'] }]
            });

            if (filePath) {
                fs.copyFileSync(apkPath, filePath);
                if(fs.existsSync(OUTPUTS_FOLDER)) fs.rmSync(OUTPUTS_FOLDER, {recursive: true})
                return { success: true, apkPath: filePath };
            } else {
                return { success: false, error: 'Save cancelled' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

