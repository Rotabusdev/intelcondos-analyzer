// CÓDIGO DE TESTE v2: Verificação de comunicação ponta a ponta
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

app.post('/api', async (req, res) => {
  console.log('--- INICIANDO TESTE DE SAÚDE DA PLATAFORMA v2---');
  
  // 1. Verificando a comunicação Supabase -> Vercel (Webhook)
  console.log('[PASSO 1/3] Webhook recebido do Supabase com sucesso.');
  const { record } = req.body;
  if (!record || !record.id) {
    console.error('ERRO: Payload do webhook inválido ou sem ID.');
    return res.status(400).send('Payload do webhook inválido.');
  }
  const documentId = record.id;
  console.log(`> ID do documento recebido: ${documentId}`);

  try {
    // 2. Verificando a comunicação Vercel -> Supabase (Conexão e Variáveis)
    console.log('[PASSO 2/3] Tentando conectar ao Supabase e buscar o documento...');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    const { data: document, error } = await supabase
      .from('document_uploads')
      .select('id, file_name, created_at') // Busca apenas alguns campos para o teste
      .eq('id', documentId)
      .single();

    if (error) {
      console.error('ERRO na consulta ao Supabase:', error.message);
      throw error; // Pula para o bloco catch
    }

    console.log('> Documento encontrado no Supabase:', document);
    console.log('[PASSO 3/3] Comunicação com Supabase bem-sucedida!');
    
    // 3. Verificando a resposta de volta para o cliente
    console.log('--- TESTE DE SAÚDE CONCLUÍDO COM SUCESSO ---');
    res.status(200).json({
      status: 'OK',
      message: 'Toda a comunicação (Git -> Vercel -> Supabase) está funcionando.',
      document_found: document
    });

  } catch (error) {
    console.error('--- TESTE DE SAÚDE FALHOU ---');
    res.status(500).json({
      status: 'FALHA',
      message: 'Houve um erro na comunicação Vercel -> Supabase.',
      error_details: error.message
    });
  }
});

module.exports = app;