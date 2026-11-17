package expo.modules.petakuwb

import android.content.pm.PackageManager
import android.os.Build
import androidx.core.uwb.UwbManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PetakUwbModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PetakUwb")

    AsyncFunction("getAvailability") Coroutine { ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val hardwareSupported =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
          context.packageManager.hasSystemFeature(PackageManager.FEATURE_UWB)
      val serviceAvailable =
        if (hardwareSupported) {
          UwbManager.createInstance(context.applicationContext).isAvailable()
        } else {
          false
        }

      mapOf(
        "hardwareSupported" to hardwareSupported,
        "serviceAvailable" to serviceAvailable
      )
    }
  }
}
