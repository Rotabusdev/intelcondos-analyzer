// Forçar novo deploy de novo
import { createClient } from '@supabase/supabase-js';
import { extractTextFromPdfBuffer } from './documentAI.js'; // Adicionar .js
import { analyzeFinancialText } from './openAI.js';   // Adicionar .js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.log('API: Método não permitido. Retornando 405.'); // Novo log
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    console.log('API: Requisição POST recebida.'); // Novo log de entrada
    const { record: newDocument } = req.body;
    if (!newDocument?.id) {
      console.error('API: Document ID ausente na requisição.'); // Log de erro mais específico
      return res.status(400).json({ error: 'Document ID is missing' });
    }

    const documentId = newDocument.id;
    console.log(`API: Processando documento com ID: ${documentId}`); // Novo log

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    console.log('API: Cliente Supabase inicializado.'); // Novo log

    // Busca os dados do documento no Supabase
    const { data: document, error: docError } = await supabase
      .from('document_uploads')
      .select('id, storage_path, condominium_id')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      console.error('API: Erro ao buscar documento no Supabase:', docError?.message || 'Documento não encontrado.'); // Log de erro mais específico
      throw new Error('Documento não encontrado no banco.');
    }
    console.log(`API: Documento encontrado no Supabase: ${document.storage_path}`); // Novo log

    // Atualiza status para 'analyzing'
    await supabase
      .from('document_uploads')
      .update({ analysis_status: 'analyzing' })
      .eq('id', documentId);
    console.log('API: Status do documento atualizado para "analyzing".'); // Novo log

    // Baixa arquivo PDF do Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(document.storage_path);

    if (downloadError) {
      console.error('API: Erro ao baixar arquivo do Supabase Storage:', downloadError.message); // Log de erro mais específico
      throw downloadError;
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    console.log(`API: Arquivo PDF (${buffer.length} bytes) baixado do Storage.`); // Novo log

    // Extrai texto do PDF usando Document AI
    console.log('API: Chamando Document AI para extrair texto...'); // Novo log
    const text = await extractTextFromPdfBuffer(buffer, {
      projectId: process.env.GCP_PROJECT_ID,
      location: process.env.GCP_LOCATION,
      processorId: process.env.GCP_PROCESSOR_ID,
    });
    console.log(`API: Texto extraído do Document AI. Tamanho: ${text.length} caracteres. (Primeiros 100 caracteres: ${text.substring(0, 100)}...)`); // Novo log

    // Analisa o texto extraído com OpenAI e retorna JSON financeiro
    console.log('API: Chamando OpenAI para analisar texto financeiro...'); // Novo log
    const financialData = await analyzeFinancialText(text, process.env.OPENAI_API_KEY);
    console.log('API: Análise financeira concluída pelo OpenAI.'); // Novo log

    // Salva resultado da análise no Supabase
    await supabase.from('financial_analysis').insert({
      condominium_id: document.condominium_id,
      document_upload_id: document.id,
      ...financialData,
    });
    console.log('API: Dados financeiros salvos no Supabase.'); // Novo log

    // Atualiza status para 'completed'
    await supabase
      .from('document_uploads')
      .update({
        analysis_status: 'completed',
        analyzed_at: new Date().toISOString(),
      })
      .eq('id', documentId);
    console.log('API: Status do documento atualizado para "completed". Análise finalizada.'); // Novo log

    return res.status(200).json({ success: true, message: 'Análise concluída com sucesso' });

  } catch (error) {
    console.error('API: Erro GERAL no handler:', error.message, error.stack); // Log de erro existente, adicionado stack trace

    if (req.body?.record?.id) {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      await supabase
        .from('document_uploads')
        .update({ analysis_status: 'failed' })
        .eq('id', req.body.record.id);
      console.error(`API: Status do documento ${req.body.record.id} atualizado para "failed".`); // Log de erro de status
    }

    return res.status(500).json({ success: false, error: error.message || 'Erro desconhecido' });
  }
}