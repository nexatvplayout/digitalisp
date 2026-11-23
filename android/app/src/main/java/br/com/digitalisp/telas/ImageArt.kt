package br.com.digitalisp.telas

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.media.ExifInterface
import java.io.File

/** Imagens da tela: o QR code (gerado no aparelho) e a leitura de imagens guardadas já no tamanho em que aparecem. */
object ImageArt {
    // ---- QR code ----
    private val qrCache = HashMap<String, Bitmap>()

    /**
     * O QR code no tamanho pedido, gerado uma vez (pelo mesmo gerador do widget `qr`: preto no branco, com margem) e
     * guardado enquanto estiver em uso. Nunca é gerado a cada quadro. Só na thread principal.
     */
    fun qr(data: String, side: Int): Bitmap? {
        if (side <= 0) return null
        val key = side.toString() + "|" + data
        qrCache[key]?.let { return it }
        return Ui.qr(data, side, margin = 4)?.also { qrCache[key] = it } // margem branca inteira (4 módulos)
    }

    /** Solta os códigos que saíram de uso. */
    fun retainQr(datas: Set<String>) {
        qrCache.keys.retainAll { it.substringAfter('|') in datas }
    }

    /** O código sobre uma placa branca (QR sobre fundo escuro não lê bem), sem suavizar os quadradinhos. */
    fun drawQr(c: Canvas, bmp: Bitmap, left: Float, top: Float, side: Float, paint: Paint) {
        paint.style = Paint.Style.FILL
        paint.color = Color.WHITE
        val m = side * 0.03f
        c.drawRoundRect(RectF(left - m, top - m, left + side + m, top + side + m), m * 2, m * 2, paint)
        paint.isFilterBitmap = false
        c.drawBitmap(bmp, null, RectF(left, top, left + side, top + side), paint)
    }

    /**
     * Decodifica a imagem já reduzida para o tamanho em que vai aparecer (TV box de 1 a 2 GB de memória: nunca abrir a
     * imagem inteira sem necessidade). Devolve null se o arquivo não for uma imagem. `alpha`: mantém a transparência
     * (a logo da revenda); sem ela, RGB_565, com metade da memória.
     */
    fun decode(file: File, maxW: Int, maxH: Int, alpha: Boolean = false): Bitmap? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) null
        else {
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= maxW || bounds.outHeight / (sample * 2) >= maxH) sample *= 2
            val opts = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = if (alpha) Bitmap.Config.ARGB_8888 else Bitmap.Config.RGB_565
            }
            val bmp = BitmapFactory.decodeFile(file.path, opts)
            if (bmp == null) null else upright(bmp, file)
        }
    } catch (_: Throwable) {
        null // inclusive falta de memória: quem chama segue sem a imagem
    }

    /** Foto de celular costuma vir deitada, com a posição certa só no EXIF. */
    private fun upright(bmp: Bitmap, file: File): Bitmap {
        val degrees = try {
            when (ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } catch (_: Throwable) {
            0f
        }
        if (degrees == 0f) return bmp
        return try {
            Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(degrees) }, true).also { if (it !== bmp) bmp.recycle() }
        } catch (_: Throwable) {
            bmp
        }
    }
}
