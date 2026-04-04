"""Pydantic schema placeholder module."""
from pydantic import BaseModel
from typing import Optional
class ProcessPhotoRequest(BaseModel):
    photo_id:str
    thread_id:str
    image_url:str #R2 URL to download the photo from 
class SearchRequest(BaseModel):
    user_id:str
    thread_id:str
    threshold : Optional[float] =0.45
    #Confidence Rate between user face and faces in image .
    #Google Photos uses 0.7
class FaceResult(BaseModel):
    photo_id:str
    similarity:float
    bbox:dict
    #Space points of face in dictonary formate , latter will used to crop the face 
class SearchResponse(BaseModel):
    matches:list[FaceResult]
    total:int
