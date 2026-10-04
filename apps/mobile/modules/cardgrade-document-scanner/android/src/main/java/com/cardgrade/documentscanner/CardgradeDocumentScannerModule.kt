package com.cardgrade.documentscanner

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

private const val REQUEST_CODE = 48173

class CardgradeDocumentScannerModule : Module() {
  private var pendingPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("CardgradeDocumentScanner")

    AsyncFunction("launchAsync") { promise: Promise ->
      if (pendingPromise != null) {
        throw Exceptions.CodedException("SCANNER_BUSY", "Document scanner is already open.")
      }

      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      pendingPromise = promise

      val options = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(true)
        .setPageLimit(1)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()

      GmsDocumentScanning.getClient(options)
        .getStartScanIntent(activity)
        .addOnSuccessListener { intentSender ->
          activity.startIntentSenderForResult(
            intentSender,
            REQUEST_CODE,
            Intent(),
            0,
            0,
            0
          )
        }
        .addOnFailureListener { error ->
          pendingPromise?.reject("SCANNER_START_FAILED", error.message, error)
          pendingPromise = null
        }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult

      val promise = pendingPromise
      pendingPromise = null

      if (promise == null) return@OnActivityResult

      if (payload.resultCode != Activity.RESULT_OK) {
        promise.resolve(null)
        return@OnActivityResult
      }

      val result = GmsDocumentScanningResult.fromActivityResultIntent(payload.data)
      val sourceUri = result?.pages?.firstOrNull()?.imageUri

      if (sourceUri == null) {
        promise.reject("SCANNER_NO_IMAGE", "Document scanner returned no JPEG image.", null)
        return@OnActivityResult
      }

      try {
        promise.resolve(copyToAppCache(sourceUri))
      } catch (error: Exception) {
        promise.reject("SCANNER_COPY_FAILED", error.message, error)
      }
    }
  }

  private fun copyToAppCache(sourceUri: Uri): Map<String, String> {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val directory = File(context.cacheDir, "cardgrade-scans").apply { mkdirs() }
    val output = File(directory, "scan-${System.currentTimeMillis()}.jpg")

    context.contentResolver.openInputStream(sourceUri).use { input ->
      if (input == null) throw IllegalStateException("Unable to open scanner result.")
      FileOutputStream(output).use { out ->
        input.copyTo(out)
      }
    }

    return mapOf("uri" to Uri.fromFile(output).toString())
  }
}
