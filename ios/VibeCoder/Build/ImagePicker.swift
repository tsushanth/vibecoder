//
//  ImagePicker.swift
//  VibeCoder
//
//  PHPickerViewController wrapper. Returns a downsized UIImage on selection.
//  Uses PHPicker (iOS 14+) which is permission-less — the picker UI runs in
//  a separate process and only hands the selected asset back, so we never
//  need NSPhotoLibraryUsageDescription nor a runtime prompt.
//

import SwiftUI
import PhotosUI
import UIKit

struct ImagePicker: UIViewControllerRepresentable {
    /// Max dimension after downsize. Keeps payloads under ~1MB for most photos.
    let maxDimension: CGFloat = 1600
    let onSelected: (UIImage) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        // .current returns HEIC on newer iPhones, which the backend can't decode
        // without help; .compatible normalizes to JPEG/PNG.
        config.preferredAssetRepresentationMode = .compatible
        let vc = PHPickerViewController(configuration: config)
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: PHPickerViewController, context: Context) {}

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let parent: ImagePicker
        init(_ parent: ImagePicker) { self.parent = parent }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            guard let item = results.first?.itemProvider, item.canLoadObject(ofClass: UIImage.self) else { return }
            let maxDim = parent.maxDimension
            let cb = parent.onSelected
            item.loadObject(ofClass: UIImage.self) { object, _ in
                guard let img = object as? UIImage else { return }
                let down = Self.downsized(img, maxDimension: maxDim)
                DispatchQueue.main.async { cb(down) }
            }
        }

        /// Resize so neither side exceeds `maxDimension`, preserving aspect ratio.
        /// Returns original if already small enough.
        static func downsized(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
            let w = image.size.width, h = image.size.height
            let m = max(w, h)
            if m <= maxDimension { return image }
            let scale = maxDimension / m
            let target = CGSize(width: w * scale, height: h * scale)
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            let renderer = UIGraphicsImageRenderer(size: target, format: format)
            return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
        }
    }
}

extension UIImage {
    /// JPEG base64 with no `data:` prefix and no line wrapping — matches the
    /// `referenceImage` field the backend's /generate route expects.
    func vibeBuildReferenceBase64(quality: CGFloat = 0.85) -> String? {
        guard let data = self.jpegData(compressionQuality: quality) else { return nil }
        return data.base64EncodedString(options: [])
    }
}
