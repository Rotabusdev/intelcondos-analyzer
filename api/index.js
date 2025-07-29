// PASSO 1.1 DO DEBUG: Verificando o valor real das variáveis de ambiente
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  console.log('DEBUG PASSO 1.1: Verificando as variáveis de ambiente...');

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // LOG DE DEBUG CRÍTICO: Vamos ver o que o servidor está realmente lendo.
    console.log(`Valor que o servidor leu para SUPABASE_URL: [${supabaseUrl}]`);
    console.log(`A chave do Supabase (KEY) existe? [${!!supabaseKey}]`); // !! transforma em true/false

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('As variáveis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY estão realmente ausentes.');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Cliente Supabase inicializado com sucesso.');

    res.status(200).json({ message: 'Passo 1.1 OK: Se você vê isso, o problema foi resolvido.' });

  } catch (error) {
    console.error('Erro no Passo 1.1 do debug:', error.message);
    res.status(500).json({ message: 'Erro no Passo 1.1.', error: error.message });
  }
});

module.exports = app;