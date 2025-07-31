// CÓDIGO DE TESTE: Verificação final com URL fixa no código
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  console.log('--- INICIANDO TESTE FINAL COM URL FIXA ---');
  
  const { record } = req.body;
  if (!record || !record.id) {
    return res.status(400).send('Payload do webhook inválido.');
  }
  const documentId = record.id;
  console.log(`> ID do documento recebido: ${documentId}`);

  try {
    // AQUI ESTÁ A MUDANÇA: Ignorando process.env.SUPABASE_URL
    const supabaseUrl = 'https://tlukxqnwrdxprwyedvlz.supabase.co';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // A chave ainda vem da variável de ambiente

    console.log(`[TESTE] Tentando conectar com a URL fixa: ${supabaseUrl}`);
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data: document, error } = await supabase
      .from('document_uploads')
      .select('id, file_name')
      .eq('id', documentId)
      .single();

    if (error) {
      console.error('ERRO na consulta ao Supabase:', error.message);
      throw error;
    }

    console.log('> Documento encontrado no Supabase:', document);
    console.log('--- TESTE COM URL FIXA BEM-SUCEDIDO ---');
    res.status(200).json({
      status: 'OK',
      message: 'A comunicação com a URL fixa no código funcionou.',
      document_found: document
    });

  } catch (error) {
    console.error('--- TESTE COM URL FIXA FALHOU ---', error);
    res.status(500).json({
      status: 'FALHA',
      error_details: error.message
    });
  }
});

module.exports = app;