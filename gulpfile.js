const { src, dest, series } = require('gulp');
const pngquant = require('gulp-pngquant');
const rename = require('gulp-rename');
const merge = require('merge-stream');
const exec = require('child_process').exec;
const fs = require('fs');
const del = require('del');

let project;

function initializeProject(done) {
    project = JSON.parse(fs.readFileSync('./vita-project.json'));
    if (project === undefined) throw "vita-project.json file is missing. It's required for the build process.";
    if (project.id === undefined || project.id.length !== 9) throw "'id' is not defined or does not conform the requirements. It must be exactly 9 characters long.";
    if (project.title === undefined) throw "'title' is not available.";

    if (project.unsafe === undefined) project.unsafe = false;
    if (project.systemDir === undefined) project.systemDir = "system";
    if (project.sourceDir === undefined) project.sourceDir = "out-src";
    if (project.tempDir === undefined) project.tempDir = ".temp";
    if (project.outDir === undefined) project.outDir = "dist";
    if (project.files === undefined) project.files = [];
    done();
}

function checkEboots(done) {
    if (!fs.existsSync(`${project.systemDir}/eboot_safe.bin`))
        throw `Safe eboot file is missing. Make sure you have the eboot_safe.bin and eboot_unsafe.bin files at the "${project.systemDir}" directory. Download them from 'https://github.com/Rinnegatamante/lpp-vita/releases/latest' if you don't have these files..`;
    if(!fs.existsSync(`${project.systemDir}/eboot_unsafe.bin`))
        throw `Unsafe eboot file is missing. Make sure you have the eboot_safe.bin and eboot_unsafe.bin files at the "${project.systemDir}" directory. Download them from 'https://github.com/Rinnegatamante/lpp-vita/releases/latest' if you don't have these files.`;
    done();
}

function clearTemp(done) {
    del(project.tempDir);
    done();
}

function clearDist(done) {
    del(`${project.outDir}/**/*`);
    done();
}

function copyFiles() {
    let sourceFilesCopy = src(`${project.sourceDir}/**/*`).pipe(dest(project.tempDir));
    let filesCopy = src([
        `${project.systemDir}/**/*`,
        `!${project.systemDir}/eboot_safe.bin`,
        `!${project.systemDir}/eboot_unsafe.bin`,
        ...project.files
    ]).pipe(dest(project.tempDir));
    let ebootCopy = src(project.unsafe ? `${project.systemDir}/eboot_unsafe.bin` : `${project.systemDir}/eboot_safe.bin`)
        .pipe(rename("eboot.bin"))
        .pipe(dest(project.tempDir));
    return merge(sourceFilesCopy, filesCopy, ebootCopy);
}

function compressImageFiles() {
    return src(`${project.tempDir}/**/*.png`)
        .pipe(pngquant())
        .pipe(dest(project.tempDir));
}

function createSfo(done) {
    const cmd = `"./.bin/vita-mksfoex" -s TITLE_ID=${project.id} "${project.title}" ${project.tempDir}\\sce_sys\\param.sfo`;
    console.log(cmd);
    exec(cmd, function (err, stdout, stderr) {
        console.log(stdout);
        console.log(stderr);
        done(err);
    });
}

function createVpk(done) {
    const cmd = `"./.bin/7z" a -tzip "${project.outDir}\\${project.title}.vpk" -r .\\${project.tempDir}\\* .\\${project.tempDir}\\eboot.bin`;
    console.log(cmd);
    exec(cmd, function (err, stdout, stderr) {
        console.log(stdout);
        console.log(stderr);
        done(err);
    });
}


exports.default = series(
    initializeProject,
    checkEboots,
    clearDist,
    copyFiles,
    compressImageFiles,
    createSfo,
    createVpk,
    clearTemp
);