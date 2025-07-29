// PASSO 1 DO DEBUG: Testando dependências e inicialização
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  console.log('DEBUG PASSO 1: Testando dependências e Supabase.');

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Variáveis de ambiente do Supabase não encontradas!');
    }

    // Apenas inicializa o cliente, não faz nenhuma consulta
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('DEBUG PASSO 1: Cliente Supabase inicializado com sucesso.');

    res.status(200).json({ message: 'Passo 1 OK: Dependências e Supabase funcionaram.' });

  } catch (error) {
    console.error('Erro no Passo 1 do debug:', error.message);
    res.status(500).json({ message: 'Erro no Passo 1.', error: error.message });
  }
});

module.exports = app;