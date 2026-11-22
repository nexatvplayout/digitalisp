package br.com.digitalisp.telas.core

import org.junit.Assert.assertEquals
import org.junit.Test

class CaptionLookTest {
    @Test fun igualATvSamsungEm1080() {
        val b = CaptionLook.box(1920, 1080)
        assertEquals(50f, b.textPx, 0.01f)
        assertEquals(22, b.padH)
        assertEquals(4, b.padV)
        assertEquals(6f, b.radiusPx, 0.01f)
        assertEquals(72, b.bottomPx)
        assertEquals(1536, b.maxWidthPx)
        assertEquals(68f, b.textPx * 1.17f + b.lineExtraPx, 0.01f)
    }

    @Test fun proporcionalAAreaDoVideo() {
        val b = CaptionLook.box(1280, 720)
        assertEquals(50f * 720 / 1080, b.textPx, 0.01f)
        assertEquals(48, b.bottomPx)
        assertEquals(1024, b.maxWidthPx)
        // a fração do texto é ≈ 0,046 da altura
        assertEquals(0.046f, b.textPx / 720f, 0.001f)
    }

    @Test fun caixaTranslucida() {
        assertEquals(0xC7, (CaptionLook.BOX_COLOR ushr 24) and 0xFF) // 0,78
        assertEquals(0x080808, CaptionLook.BOX_COLOR and 0xFFFFFF)
        assertEquals(0, CaptionLook.box(0, 0).bottomPx) // sem tamanho ainda: nada quebra
    }
}
