package com.kreativekoala.vibecoder.util

import android.util.Base64
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

object ZipExtractor {

    fun extractBundle(base64Bundle: String, cacheDir: File): File {
        val zipBytes = Base64.decode(base64Bundle, Base64.DEFAULT)
        val destDir = File(cacheDir, "projects/${UUID.randomUUID()}")
        destDir.mkdirs()

        ZipInputStream(ByteArrayInputStream(zipBytes)).use { zis ->
            var entry: ZipEntry? = zis.nextEntry
            while (entry != null) {
                val file = File(destDir, entry.name)

                // Prevent zip slip attack
                if (!file.canonicalPath.startsWith(destDir.canonicalPath + File.separator) &&
                    file.canonicalPath != destDir.canonicalPath
                ) {
                    throw SecurityException("Zip path traversal detected: ${entry.name}")
                }

                if (entry.isDirectory) {
                    file.mkdirs()
                } else {
                    file.parentFile?.mkdirs()
                    FileOutputStream(file).use { fos ->
                        zis.copyTo(fos)
                    }
                }

                zis.closeEntry()
                entry = zis.nextEntry
            }
        }

        // Find index.html — may be at root or nested in a subdirectory
        if (File(destDir, "index.html").exists()) {
            return destDir
        }

        // Scan subdirectories for index.html (ZIP may wrap in a folder)
        val indexFile = destDir.walkTopDown().find { it.name == "index.html" }
        require(indexFile != null) {
            "Generated bundle is missing index.html"
        }

        return indexFile.parentFile ?: destDir
    }

    fun directoryToBase64(dir: File): String {
        val outputStream = java.io.ByteArrayOutputStream()
        ZipOutputStream(outputStream).use { zos ->
            dir.walkTopDown().forEach { file ->
                if (file.isFile) {
                    val relativePath = file.relativeTo(dir).path
                    val zipEntry = ZipEntry(relativePath)
                    zos.putNextEntry(zipEntry)
                    file.inputStream().use { it.copyTo(zos) }
                    zos.closeEntry()
                }
            }
        }
        return Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
    }

    fun cleanupOldProjects(cacheDir: File, keepLatest: Int = 5) {
        val projectsDir = File(cacheDir, "projects")
        if (!projectsDir.exists()) return

        val dirs = projectsDir.listFiles()
            ?.filter { it.isDirectory }
            ?.sortedByDescending { it.lastModified() }
            ?: return

        dirs.drop(keepLatest).forEach { it.deleteRecursively() }
    }
}
