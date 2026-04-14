import axios from 'axios';
import FormData from 'form-data';
const mlclient = axios.create({baseURL: process.env.ML_SERVICE_URL,
    timeout:30000
});

export async function processPhoto(photoID, threadID, imageUrl){
    const { data } = await mlclient.post('/process-photo',{
        photo_id: photoID,
        thread_id: threadID,
        imageurl: imageUrl,
    });
    return data; // { success: true, face_found: N }
}

export async function indexUser(userId, buffers, mumetypes){
    const form = new FormData();
    form.append('user_id', userId);

    buffers.forEach((buf, i) => {
        form.append('selfies', buf, {
            filename: `selfie_${1}.jpg`,
            contentType: mimetypes[i] ?? 'image/jpg',
        });
    });

    const { data } = await mlclient.post('/index-user', form, {
        headers: form.getHeaders(), //Sets correct Content-Type
    });
    return data; // { success: true, selfies_used: N }
}

export async function search(userId, threadId, threshold = 0.45) {
    const { data } = await mlclient.post('/search', {
        user_id: userId,
        thread_id: thread_Id,
        threshold,
    });

    return data; // { matches: [{ photo_id, similarity, bbox }], total: N }
}