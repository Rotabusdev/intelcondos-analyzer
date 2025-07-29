// DEBUG FINAL: Verificando os valores de TODAS as variáveis de ambiente
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  console.log('--- INICIANDO DEBUG DAS VARIÁVEIS ---');
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const visionKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;

    // Log de todas as variáveis para encontrar o problema
    console.log(`[DEBUG] Valor para SUPABASE_URL: ${supabaseUrl}`);
    console.log(`[DEBUG] Chave do Supabase existe? ${!!supabaseKey}`);
    console.log(`[DEBUG] Chave da OpenAI existe? ${!!openaiKey}`);
    console.log(`[DEBUG] Valor para GOOGLE_CLOUD_VISION_API_KEY: ${visionKey}`);
    console.log('--- FIM DO LOG DE VARIÁVEIS ---');

    // Teste mínimo para garantir que não há erro aqui
    if (!supabaseUrl || !visionKey) {
        throw new Error("URL do Supabase ou Chave do Vision estão faltando!");
    }

    res.status(200).json({ message: 'Teste de variáveis concluído. Verifique os logs da Vercel.' });

  } catch (error) {
    console.error('ERRO NO DEBUG:', error.message, error.stack);
    res.status(500).json({ message: 'Erro durante o debug das variáveis.', error: error.message });
  }
});

module.exports = app;