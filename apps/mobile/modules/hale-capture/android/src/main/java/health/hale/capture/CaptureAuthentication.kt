package health.hale.capture

import android.util.Base64
import com.clerk.api.Clerk
import com.clerk.api.network.serialization.ClerkResult
import com.clerk.api.session.GetTokenOptions
import com.clerk.api.session.fetchToken
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

internal object CaptureAuthentication {
  private fun claims(token: String): JSONObject? = try {
    JSONObject(String(Base64.decode(token.split('.')[1], Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8))
  } catch (_: Exception) { null }

  fun tokenFor(owner: String): String? {
    if (Clerk.isInitialized.value && Clerk.user?.id != owner) {
      CaptureJournal.stopRequested = true
      CaptureJournal.token = ""
      return null
    }
    val current = CaptureJournal.token
    val payload = claims(current)
    if (payload?.optString("sub") == owner && payload.optLong("exp") > System.currentTimeMillis() / 1000 + 15) return current
    // Use the same native Clerk session as AuthView; no session secret is copied into our journal.
    val session = Clerk.session ?: return null
    if (Clerk.user?.id != owner) {
      CaptureJournal.stopRequested = true
      CaptureJournal.token = ""
      return null
    }
    val result = runBlocking { withTimeout(15000) { session.fetchToken(GetTokenOptions(template = "convex")) } }
    val jwt = (result as? ClerkResult.Success)?.value?.jwt ?: return null
    if (claims(jwt)?.optString("sub") != owner) return null
    CaptureJournal.token = jwt
    return jwt
  }
}
