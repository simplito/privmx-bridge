/*!
PrivMX Bridge.
Copyright © 2024 Simplito sp. z o.o.

This file is part of the PrivMX Platform (https://privmx.dev).
This software is Licensed under the PrivMX Free License.

See the License for the specific language governing permissions and
limitations under the License.
*/

export type NumericEnumerable = {[index: number]: number};

export interface DetectionResult {
    ext: string;
    mime: string;
}

export class ImageTypeDetector {
    
    static check(header: number[], data: NumericEnumerable) {
        for (let i = 0; i < header.length; i++) {
            if (header[i] !== data[i]) {
                return false;
            }
        }
        return true;
    }
    
    static detect(data: NumericEnumerable): DetectionResult|null {
        if (ImageTypeDetector.check([0xFF, 0xD8, 0xFF], data)) {
            return {
                ext: "jpg",
                mime: "image/jpeg"
            };
        }
        if (ImageTypeDetector.check([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], data)) {
            return {
                ext: "png",
                mime: "image/png"
            };
        }
        if (ImageTypeDetector.check([0x47, 0x49, 0x46], data)) {
            return {
                ext: "gif",
                mime: "image/gif"
            };
        }
        if (ImageTypeDetector.check([0x49, 0x49, 0x2A, 0x0], data) || ImageTypeDetector.check([0x4D, 0x4D, 0x0, 0x2A], data)) {
            return {
                ext: "tif",
                mime: "image/tiff"
            };
        }
        if (ImageTypeDetector.check([0x42, 0x4D], data)) {
            return {
                ext: "bmp",
                mime: "image/bmp"
            };
        }
        return null;
    }
    
    static isValid(data: NumericEnumerable): boolean {
        return ImageTypeDetector.detect(data) !== null;
    }
}
