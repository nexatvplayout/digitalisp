package br.com.digitalisp.instalador.ui

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Cores e peças visuais da marca DIGITAL ISP (marca/). */
object Marca {
    val MARINHO = Color.parseColor("#0A2150")
    val AZUL = Color.parseColor("#0D80FF")
    val CIANO = Color.parseColor("#14C4CC")
    val FUNDO = Color.parseColor("#F4F7FB")
    val TEXTO = Color.parseColor("#1B2433")
    val TEXTO_FRACO = Color.parseColor("#5B6678")
    val ERRO = Color.parseColor("#C62828")
    val BRANCO = Color.WHITE
}

fun Context.dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

fun Context.titulo(texto: String) = TextView(this).apply {
    text = texto
    textSize = 22f
    setTypeface(typeface, Typeface.BOLD)
    setTextColor(Marca.MARINHO)
    setPadding(0, dp(8), 0, dp(8))
}

fun Context.paragrafo(texto: String, cor: Int = Marca.TEXTO) = TextView(this).apply {
    text = texto
    textSize = 16f
    setTextColor(cor)
    setLineSpacing(0f, 1.2f)
    setPadding(0, dp(4), 0, dp(4))
}

fun Context.botao(texto: String, principal: Boolean = true, acao: () -> Unit) = Button(this).apply {
    text = texto
    isAllCaps = false
    textSize = 16f
    setTextColor(if (principal) Marca.BRANCO else Marca.AZUL)
    background = GradientDrawable().apply {
        cornerRadius = dp(10).toFloat()
        if (principal) setColor(Marca.AZUL) else { setColor(Marca.BRANCO); setStroke(dp(2), Marca.AZUL) }
    }
    minHeight = dp(52)
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        .apply { topMargin = dp(10) }
    setOnClickListener { acao() }
}

fun Context.cartao(titulo: String, detalhe: String, destaque: Boolean, acao: () -> Unit) = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(16), dp(14), dp(16), dp(14))
    background = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat()
        setColor(Marca.BRANCO)
        setStroke(dp(if (destaque) 2 else 1), if (destaque) Marca.CIANO else Color.parseColor("#D5DCE6"))
    }
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        .apply { topMargin = dp(10) }
    isClickable = true
    isFocusable = true
    addView(TextView(context).apply {
        text = titulo; textSize = 17f; setTypeface(typeface, Typeface.BOLD); setTextColor(Marca.MARINHO)
    })
    addView(TextView(context).apply { text = detalhe; textSize = 14f; setTextColor(Marca.TEXTO_FRACO) })
    setOnClickListener { acao() }
    gravity = Gravity.START
}
