// Forçar novo deploy de novo
import { createClient } from '@supabase/supabase-js';
import { extractTextFromPdfBuffer } from './documentAI';
import { analyzeFinancialText } from './openAI';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { record: newDocument } = req.body;
    if (!newDocument?.id) {
      return res.status(400).json({ error: 'Document ID is missing' });
    }

    const documentId = newDocument.id;
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Busca os dados do documento no Supabase
    const { data: document, error: docError } = await supabase
      .from('document_uploads')
      .select('id, storage_path, condominium_id')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Documento não encontrado no banco.');
    }

    // Atualiza status para 'analyzing'
    await supabase
      .from('document_uploads')
      .update({ analysis_status: 'analyzing' })
      .eq('id', documentId);

    // Baixa arquivo PDF do Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(document.storage_path);

    if (downloadError) throw downloadError;

    const buffer = Buffer.from(await fileData.arrayBuffer());

    // Extrai texto do PDF usando Document AI
    const text = await extractTextFromPdfBuffer(buffer, {
      projectId: process.env.GCP_PROJECT_ID,
      location: process.env.GCP_LOCATION,
      processorId: process.env.GCP_PROCESSOR_ID,
    });

    // Analisa o texto extraído com OpenAI e retorna JSON financeiro
    const financialData = await analyzeFinancialText(text, process.env.OPENAI_API_KEY);

    // Salva resultado da análise no Supabase
    await supabase.from('financial_analysis').insert({
      condominium_id: document.condominium_id,
      document_upload_id: document.id,
      ...financialData,
    });

    // Atualiza status para 'completed'
    await supabase
      .from('document_uploads')
      .update({
        analysis_status: 'completed',
        analyzed_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    return res.status(200).json({ success: true, message: 'Análise concluída com sucesso' });

  } catch (error) {
    console.error('Erro na análise:', error.message || error);

    if (req.body?.record?.id) {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      await supabase
        .from('document_uploads')
        .update({ analysis_status: 'failed' })
        .eq('id', req.body.record.id);
    }

    return res.status(500).json({ success: false, error: error.message || 'Erro desconhecido' });
  }
}
