#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const directoryPath = path.resolve(__dirname, "../src");
const license = `/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

`;

let visited = 0;
let updated = 0;

function prependToFile(filePath, contentToAdd) {
    visited++;
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    if (!originalContent.startsWith(contentToAdd)) {
        const newContent = contentToAdd + originalContent;
        fs.writeFileSync(filePath, newContent, 'utf-8');
        updated++;
        console.log(`Updated: ${filePath}`);
    }
}

function processDirectory(directoryPath) {
    const files = fs.readdirSync(directoryPath);
    
    files.forEach(file => {
        const fullPath = path.join(directoryPath, file);
        const fileStat = fs.statSync(fullPath);
        
        if (fileStat.isDirectory()) {
            processDirectory(fullPath);
        }
        else if (fileStat.isFile() && file.endsWith('.ts')) {
            prependToFile(fullPath, license);
        }
    });
}

processDirectory(directoryPath);
console.log(`Adding the license is complete, files visited: ${visited}, updated: ${updated}`)
