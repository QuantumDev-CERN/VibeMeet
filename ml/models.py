from pydantic import BaseModel
from typing import Optional
class ProcessPhotoRequest(BaseModel):
    photo_id:str
    thread_id:str
    image_url:str 
class SearchRequest(BaseModel):
    user_id:str
    thread_id:str
    threshold : Optional[float] =0.45
class FaceResult(BaseModel):
    photo_id:str
    similarity:float
    bbox:dict
class SearchResponse(BaseModel):
    matches:list[FaceResult]
    total:int
