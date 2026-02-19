import Foundation
import Compression
import ZIPFoundation

enum ZipError: Error, LocalizedError {
    case invalidData
    case unsupportedCompression(Int)
    case decompressionFailed
    case missingIndexHTML

    var errorDescription: String? {
        switch self {
        case .invalidData: return "Invalid zip data"
        case .unsupportedCompression(let m): return "Unsupported compression method: \(m)"
        case .decompressionFailed: return "Failed to decompress file"
        case .missingIndexHTML: return "Game bundle missing index.html"
        }
    }
}

/// Minimal zip extractor using Apple's Compression framework.
/// Handles Stored (method 0) and Deflated (method 8) entries — sufficient for game bundles.
struct ZipExtractor {

    static func extract(data: Data, to destination: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)

        var offset = 0

        while offset + 30 <= data.count {
            // Local file header signature = PK\x03\x04
            guard data[offset] == 0x50, data[offset+1] == 0x4B,
                  data[offset+2] == 0x03, data[offset+3] == 0x04 else {
                break
            }

            let flags = data.readUInt16(at: offset + 6)
            let method = Int(data.readUInt16(at: offset + 8))
            var compressedSize = Int(data.readUInt32(at: offset + 18))
            var uncompressedSize = Int(data.readUInt32(at: offset + 22))
            let nameLen = Int(data.readUInt16(at: offset + 26))
            let extraLen = Int(data.readUInt16(at: offset + 28))

            let nameStart = offset + 30
            guard nameStart + nameLen <= data.count else { break }

            let nameData = data.subdata(in: nameStart..<nameStart + nameLen)
            guard let name = String(data: nameData, encoding: .utf8), !name.isEmpty else {
                offset = nameStart + nameLen + extraLen + compressedSize
                continue
            }

            let dataStart = nameStart + nameLen + extraLen

            // Handle data descriptor (bit 3 of flags)
            if flags & 0x08 != 0, compressedSize == 0 {
                // Sizes are in a data descriptor after the file data.
                // Scan forward for the next PK signature or descriptor signature.
                compressedSize = findCompressedSize(in: data, from: dataStart)
                // We can't reliably get uncompressedSize without the descriptor,
                // so estimate generously for decompression buffer.
                uncompressedSize = max(compressedSize * 4, 65536)
            }

            guard dataStart + compressedSize <= data.count else { break }

            // Security: prevent path traversal (zip slip)
            let fullPath = destination.appendingPathComponent(name).standardized
            guard fullPath.path.hasPrefix(destination.standardized.path) else {
                offset = dataStart + compressedSize + (flags & 0x08 != 0 ? descriptorSize(in: data, at: dataStart + compressedSize) : 0)
                continue
            }

            if name.hasSuffix("/") {
                try fm.createDirectory(at: fullPath, withIntermediateDirectories: true)
            } else {
                try fm.createDirectory(at: fullPath.deletingLastPathComponent(), withIntermediateDirectories: true)

                let fileData = data.subdata(in: dataStart..<dataStart + compressedSize)

                switch method {
                case 0: // Stored
                    try fileData.write(to: fullPath)
                case 8: // Deflate
                    let decompressed = try inflate(fileData, expectedSize: uncompressedSize)
                    try decompressed.write(to: fullPath)
                default:
                    throw ZipError.unsupportedCompression(method)
                }
            }

            var nextOffset = dataStart + compressedSize
            // Skip data descriptor if present
            if flags & 0x08 != 0 {
                nextOffset += descriptorSize(in: data, at: nextOffset)
            }
            offset = nextOffset
        }
    }

    /// Extract base64 zip string to a new temp directory, returns the directory URL.
    static func extractBundle(base64: String) throws -> URL {
        guard let zipData = Data(base64Encoded: base64) else {
            throw ZipError.invalidData
        }

        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("games")
            .appendingPathComponent(UUID().uuidString)

        try extract(data: zipData, to: dir)

        // Verify index.html exists
        let indexPath = dir.appendingPathComponent("index.html")
        guard FileManager.default.fileExists(atPath: indexPath.path) else {
            throw ZipError.missingIndexHTML
        }

        return dir
    }

    /// Zip a directory into Data using ZIPFoundation
    static func zipDirectory(_ directory: URL) throws -> Data {
        let fm = FileManager.default
        let tempZip = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".zip")

        defer {
            try? fm.removeItem(at: tempZip)
        }

        // Create archive
        guard let archive = Archive(url: tempZip, accessMode: .create) else {
            throw ZipError.decompressionFailed
        }

        // Get all files in directory
        let enumerator = fm.enumerator(at: directory, includingPropertiesForKeys: [.isRegularFileKey])

        while let fileURL = enumerator?.nextObject() as? URL {
            let resourceValues = try fileURL.resourceValues(forKeys: [.isRegularFileKey])
            guard resourceValues.isRegularFile == true else { continue }

            let relativePath = fileURL.path.replacingOccurrences(of: directory.path + "/", with: "")

            try archive.addEntry(with: relativePath, relativeTo: directory)
        }

        return try Data(contentsOf: tempZip)
    }

    // MARK: - Helpers

    private static func inflate(_ data: Data, expectedSize: Int) throws -> Data {
        let bufferSize = max(expectedSize, data.count * 4)
        var result = Data(count: bufferSize)

        let decodedSize = data.withUnsafeBytes { src -> Int in
            result.withUnsafeMutableBytes { dst -> Int in
                guard let srcPtr = src.baseAddress?.assumingMemoryBound(to: UInt8.self),
                      let dstPtr = dst.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return 0 }
                return compression_decode_buffer(dstPtr, bufferSize, srcPtr, data.count, nil, COMPRESSION_ZLIB)
            }
        }

        guard decodedSize > 0 else { throw ZipError.decompressionFailed }
        result.count = decodedSize
        return result
    }

    /// Scan for the next local file header to determine compressed data size.
    private static func findCompressedSize(in data: Data, from start: Int) -> Int {
        var pos = start
        while pos + 4 <= data.count {
            if data[pos] == 0x50, data[pos+1] == 0x4B,
               (data[pos+2] == 0x03 && data[pos+3] == 0x04) ||  // next local header
               (data[pos+2] == 0x01 && data[pos+3] == 0x02) {   // central directory
                // Check for data descriptor signature before this
                if pos >= start + 4,
                   data[pos-16] == 0x50, data[pos-15] == 0x4B,
                   data[pos-14] == 0x07, data[pos-13] == 0x08 {
                    return pos - start - 16
                }
                // Without descriptor signature, the descriptor is 12 bytes before
                return max(0, pos - start - 12)
            }
            pos += 1
        }
        return data.count - start
    }

    /// Size of data descriptor (12 or 16 bytes depending on whether it has a signature).
    private static func descriptorSize(in data: Data, at offset: Int) -> Int {
        guard offset + 4 <= data.count else { return 0 }
        if data[offset] == 0x50, data[offset+1] == 0x4B,
           data[offset+2] == 0x07, data[offset+3] == 0x08 {
            return 16 // signature (4) + crc (4) + compressed (4) + uncompressed (4)
        }
        return 12 // crc (4) + compressed (4) + uncompressed (4)
    }
}

// MARK: - Data helpers for little-endian reads (alignment-safe)

private extension Data {
    func readUInt16(at offset: Int) -> UInt16 {
        guard offset + 2 <= count else { return 0 }
        return UInt16(self[offset]) | (UInt16(self[offset + 1]) << 8)
    }

    func readUInt32(at offset: Int) -> UInt32 {
        guard offset + 4 <= count else { return 0 }
        return UInt32(self[offset])
            | (UInt32(self[offset + 1]) << 8)
            | (UInt32(self[offset + 2]) << 16)
            | (UInt32(self[offset + 3]) << 24)
    }
}
